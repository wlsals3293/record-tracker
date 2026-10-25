import fs from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { test, expect, date, start, appData, startApp, storage, openRestore, mode, apply } from './helpers.mjs';

test('legacy metrics display correctly and edits persist zero and omitted fields through reload', async ({ page }) => {
  const legacy = { id: 'legacy', timestamp: start, result: null, dataMb: 12.5, lengthSeconds: 60, memo: '보존' };
  const original = { version: 2, sessionsByDate: { [date]: [{ records: [legacy] }] } };
  await startApp(page, original);
  const size = page.getByLabel('Data MB', { exact: true });
  const duration = page.getByLabel('Length seconds', { exact: true });
  await expect(size).toHaveValue('12.5');
  await expect(duration).toHaveValue('60');
  await expect(page.locator('#data-stat')).toContainText('12.5 MB');
  await expect(page.locator('#length-stat')).toContainText('60 초');
  expect(await storage(page)).toEqual(original);

  await size.fill('0'); await size.press('Tab');
  await duration.fill(''); await duration.press('Tab');
  const expected = { version: 3, sessionsByDate: { [date]: [{ records: [
    { id: 'legacy', timestamp: start, result: null, size: 0, memo: '보존' },
  ] }] } };
  expect(await storage(page)).toEqual(expected);
  await page.reload();
  await expect(size).toHaveValue('0');
  await expect(duration).toHaveValue('');
  await expect(page.locator('#data-stat')).toHaveText('0 GB · 0 MB');
  await expect(page.locator('#length-stat')).toHaveText('0 시간 · 0 초');

  await duration.fill('7'); await duration.press('Tab');
  await size.fill(''); await size.press('Tab');
  const saved = (await storage(page)).sessionsByDate[date][0].records[0];
  expect(saved).not.toHaveProperty('size');
  expect(saved.duration).toBe(7);
  await page.reload();
  await expect(size).toHaveValue('');
  await expect(duration).toHaveValue('7');
});

test('empty metrics stay omitted in storage, backup and RT2 and restore as blank inputs', async ({ page }) => {
  await startApp(page, appData([]));
  await page.locator('#add-record').click();
  const saved = await storage(page), record = saved.sessionsByDate[date][0].records[0];
  expect(record).not.toHaveProperty('size');
  expect(record).not.toHaveProperty('duration');
  expect(record.result).toBeNull();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  const shared = await page.locator('#export-text').inputValue();
  expect(shared).toMatch(/^RT2:/);
  expect(JSON.parse(gunzipSync(Buffer.from(shared.slice(4), 'base64url')))).toEqual({ version: 2, records: [record] });
  await page.keyboard.press('Escape');

  const downloading = page.waitForEvent('download');
  await page.getByLabel('더보기 메뉴', { exact: true }).click();
  await page.getByRole('menuitem', { name: '전체 백업 다운로드', exact: true }).click();
  const download = await downloading;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(exported.data).toEqual(saved);

  const size = page.getByLabel('Data MB', { exact: true });
  await size.fill('5'); await size.press('Tab');
  await openRestore(page, exported.data); await mode(page, 'replace'); await apply(page);
  await page.reload();
  expect(await storage(page)).toEqual(saved);
  await expect(size).toHaveValue('');
  await expect(page.getByLabel('Length seconds', { exact: true })).toHaveValue('');
  await expect(page.locator('#data-stat')).toHaveText('0 GB · 0 MB');
  await expect(page.locator('#length-stat')).toHaveText('0 시간 · 0 초');
});

test('legacy RT1 and compact RT2 imports share the same normalized UI and stored format', async ({ page }) => {
  await startApp(page, appData([]));
  const legacy = { id: 'legacy', timestamp: start, result: null, dataMb: 0, lengthSeconds: 60 };
  const compact = { id: 'compact', timestamp: start + 1000, result: 'success', duration: 0 };
  for (const [prefix, version, record] of [['RT1:', 1, legacy], ['RT2:', 2, compact]]) {
    const shared = prefix + gzipSync(JSON.stringify({ version, records: [record] })).toString('base64url');
    await page.getByRole('button', { name: '가져오기', exact: true }).click();
    await page.locator('#import-text').fill(shared);
    await page.getByRole('button', { name: '가져오기 병합', exact: true }).click();
    await expect(page.locator('#import-dialog')).not.toBeVisible();
  }
  expect((await storage(page)).sessionsByDate[date][0].records).toEqual([
    { id: 'legacy', timestamp: start, result: null, size: 0, duration: 60 }, compact,
  ]);
  await page.reload();
  await expect(page.locator('.record-row')).toHaveCount(2);
  await expect(page.locator('.record-row[data-id="legacy"] [data-field="size"]')).toHaveValue('0');
  await expect(page.locator('.record-row[data-id="compact"] [data-field="size"]')).toHaveValue('');
  await expect(page.locator('.record-row[data-id="compact"] [data-field="duration"]')).toHaveValue('0');
  await expect(page.locator('#length-stat')).toContainText('60 초');
});
