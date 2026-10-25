import { test, expect, date, item, appData, startApp, storage } from './helpers.mjs';

test('new records use 12-character URL-safe IDs and preserve legacy IDs on reload', async ({ page }) => {
  const legacy = item(0, { id: '123e4567-e89b-42d3-a456-426614174000' });
  await startApp(page, appData([legacy]));
  await page.locator('#add-record').click();
  await page.locator('#add-record').click();

  const saved = await storage(page);
  const records = saved.sessionsByDate[date][0].records;
  expect(records).toHaveLength(3);
  for (const record of records.slice(0, 2)) expect(record.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(records[0].id).not.toBe(records[1].id);
  expect(records[2]).toEqual(legacy);

  await page.reload();
  expect(await storage(page)).toEqual(saved);
  await expect(page.locator('.record-row')).toHaveCount(3);
  for (const record of records) {
    await expect(page.locator(`.record-row[data-id="${record.id}"]`)).toBeVisible();
  }
});

test('ID retries cover every session of the selected date and skip other dates', async ({ page }) => {
  const targetDate = '2026-10-06';
  // Repeated bytes produce known IDs, allowing actual collisions to be exercised.
  const ids = ['A', 'B', 'C', 'D'].map((character) => character.repeat(12));
  const seed = appData([item(0, { id: ids[2] })]);
  seed.sessionsByDate[targetDate] = [0, 1].map((index) => ({
    records: [item(index, {
      id: ids[index], timestamp: Date.parse(targetDate + 'T12:00:00+09:00') + index * 1000,
    })],
  }));
  await startApp(page, seed);
  await page.locator('#date-filter').fill(targetDate);

  await page.evaluate(() => {
    const original = crypto.getRandomValues.bind(crypto);
    const bytes = [0, 1, 2, 2, 3];
    window.__idAttempts = 0;
    crypto.getRandomValues = (array) => {
      if (!(array instanceof Uint8Array) || array.length !== 12) return original(array);
      window.__idAttempts++;
      const next = bytes.shift();
      if (next === undefined) throw new Error('Unexpected extra ID generation');
      return array.fill(next);
    };
  });

  await page.locator('#add-record').click();
  expect(await page.evaluate(() => window.__idAttempts)).toBe(3);
  expect((await storage(page)).sessionsByDate[targetDate][0].records[0].id).toBe(ids[2]);

  // A second addition must also see the record that was just created.
  await page.locator('#add-record').click();
  expect(await page.evaluate(() => window.__idAttempts)).toBe(5);
  const saved = await storage(page);
  expect(saved.sessionsByDate[targetDate][0].records.map((record) => record.id)).toEqual([
    ids[3], ids[2], ids[0],
  ]);
  expect(saved.sessionsByDate[targetDate][1]).toEqual(seed.sessionsByDate[targetDate][1]);
  expect(saved.sessionsByDate[date]).toEqual(seed.sessionsByDate[date]);
});

test('IDs handle high random byte values and persist URL-safe punctuation', async ({ page }) => {
  await startApp(page, appData([]));
  await page.evaluate(() => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (array) => {
      if (!(array instanceof Uint8Array) || array.length !== 12) return original(array);
      array.set([0, 25, 26, 51, 52, 61, 62, 63, 64, 127, 128, 255]);
      return array;
    };
  });

  await page.locator('#add-record').click();
  const id = 'AZaz09-_A_A_';
  expect((await storage(page)).sessionsByDate[date][0].records[0].id).toBe(id);
  await expect(page.locator(`.record-row[data-id="${id}"]`)).toBeVisible();
  await page.reload();
  expect((await storage(page)).sessionsByDate[date][0].records[0].id).toBe(id);
  await expect(page.locator(`.record-row[data-id="${id}"]`)).toBeVisible();
});
