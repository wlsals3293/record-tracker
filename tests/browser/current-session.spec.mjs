import fs from 'node:fs/promises';
import { test, expect, date, appData, startApp, storage, openRestore, mode, apply } from './helpers.mjs';

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
  const replacement = { version: 2, sessionsByDate: { '2026-10-06': [{ name: '복원한 세션', records: [] }] } };
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
