import fs from 'node:fs/promises';
import { test, expect, date, start, item, appData, startApp, storage, openRestore, mode, apply } from './helpers.mjs';

test('refresh keeps the selected date and session, and backups contain only record data', async ({ page }) => {
  const data = appData();
  data.sessionsByDate['2026-10-06'] = [{ records: [] }, { name: '이전 날짜 세션', records: [] }];
  await startApp(page, data);
  await page.locator('#date-filter').fill('2026-10-06');
  await page.locator('#date-filter').dispatchEvent('change');
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await page.reload();
  await expect(page.locator('#date-filter')).toHaveValue('2026-10-06');
  await expect(page.locator('#session-name')).toHaveText('이전 날짜 세션');
  expect(await storage(page)).toEqual(data);
  const downloading = page.waitForEvent('download');
  await page.getByLabel('더보기 메뉴', { exact: true }).click();
  await page.getByRole('menuitem', { name: '전체 백업 다운로드', exact: true }).click();
  const download = await downloading;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(backup.data).toEqual(data);
  expect(Object.keys(backup)).toEqual(['format', 'backupVersion', 'createdAt', 'data']);
  await page.getByRole('button', { name: '이전 세션', exact: true }).click();
  await page.reload();
  await expect(page.locator('#session-name')).toHaveText('세션 1');
});

test('new sessions and replacement restore update the remembered position', async ({ page }) => {
  await startApp(page);
  await page.getByRole('button', { name: '세션 추가', exact: true }).click();
  await page.reload();
  await expect(page.locator('#session-name')).toHaveText('세션 3');
  const replacement = { version: 3, sessionsByDate: { '2026-10-06': [{ name: '복원한 세션', records: [] }] } };
  await openRestore(page, replacement);
  await mode(page, 'replace');
  await apply(page);
  await page.reload();
  await expect(page.locator('#date-filter')).toHaveValue('2026-10-06');
  await expect(page.locator('#session-name')).toHaveText('복원한 세션');
});

test('stale session positions fall back to the first session on refresh', async ({ page }) => {
  await startApp(page);
  await page.evaluate((date) => localStorage.setItem('record-tracker-current-session', JSON.stringify({ date, index: 99 })), date);
  await page.reload();
  await expect(page.locator('#session-name')).toHaveText('운동');
});

test('today immediately opens the first session and clears selection from another date', async ({ page }) => {
  const previousDate = '2026-10-06';
  const data = appData([item(0)]);
  data.sessionsByDate[previousDate] = [
    { records: [] },
    { name: '이전 날짜 세션', records: [item(1, { timestamp: start - 86400000 })] },
  ];
  await startApp(page, data);
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await page.locator('#date-filter').fill(previousDate);
  await page.locator('#date-filter').dispatchEvent('change');
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await page.getByRole('button', { name: '선택', exact: true }).click();
  await page.getByRole('checkbox', { name: '1번 기록 선택', exact: true }).check();
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

  await page.getByRole('button', { name: '오늘', exact: true }).click();

  await expect(page.locator('#date-filter')).toHaveValue(date);
  await expect(page.locator('#session-name')).toHaveText('운동');
  await expect(page.locator('.record-row')).toHaveAttribute('data-id', 'current-0');
  await expect(page.locator('#app')).not.toHaveClass(/selection-mode/);
  expect(dialogs).toEqual([]);
  expect(await storage(page)).toEqual(data);
  await page.reload();
  await expect(page.locator('#date-filter')).toHaveValue(date);
  await expect(page.locator('#session-name')).toHaveText('운동');
});

test('today leaves the current session, filter and selection untouched when already on today', async ({ page }) => {
  const data = appData();
  data.sessionsByDate[date][1].records = [item(1, { result: 'success' })];
  await startApp(page, data);
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await page.locator('[data-action="filter-result"][data-filter="success"]').click();
  await page.getByRole('button', { name: '선택', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: '1번 기록 선택', exact: true });
  await checkbox.check();
  const row = await page.locator('.record-row').elementHandle();
  const dialogs = [];
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

  await page.getByRole('button', { name: '오늘', exact: true }).click();

  await expect(page.locator('#date-filter')).toHaveValue(date);
  await expect(page.locator('#session-name')).toHaveText('별도');
  await expect(page.locator('[data-filter="success"]')).toHaveAttribute('aria-selected', 'true');
  await expect(checkbox).toBeChecked();
  await expect(page.locator('.selection-count-badge')).toHaveText('1개 선택');
  expect(await row.evaluate((element) => element.isConnected)).toBe(true);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => window.__writes)).toBe(0);
  expect(await storage(page)).toEqual(data);
});

test('today opens an empty first session when the new day has no saved sessions', async ({ page }) => {
  await startApp(page);
  await page.clock.setFixedTime(new Date(start + 86400000));

  await page.getByRole('button', { name: '오늘', exact: true }).click();

  await expect(page.locator('#date-filter')).toHaveValue('2026-10-08');
  await expect(page.locator('#session-name')).toHaveText('세션 1');
  await expect(page.locator('.record-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이전 세션', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '다음 세션', exact: true })).toBeDisabled();
});
