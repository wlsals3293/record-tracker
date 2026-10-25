import fs from 'node:fs/promises';
import { test, expect, date, start, item, appData, payload, startApp, storage, openDialog, openRestore, mode, apply } from './helpers.mjs';

test('download includes the latest in-memory values after a failed save', async ({ page }) => {
  const original = appData([item(0)]);
  await startApp(page, original);
  await page.clock.pauseAt(new Date(start + 60_000));
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator('.record-row input[data-field="dataMb"]').fill('7654');
  await page.clock.runFor(350);
  expect(await storage(page)).toEqual(original);
  const downloading = page.waitForEvent('download');
  await page.getByLabel('더보기 메뉴', { exact: true }).click();
  await page.getByRole('menuitem', { name: '전체 백업 다운로드', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^record-tracker-backup-\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  const expected = structuredClone(original);
  expected.sessionsByDate[date][0].records[0].dataMb = 7654;
  expect(exported.data).toEqual(expected);
  expect(Object.keys(exported)).toEqual(['format', 'backupVersion', 'createdAt', 'data']);
  expect(await page.evaluate(() => window.__themeAccess)).toEqual([]);
});

test('cancel and failed replacement preserve the current view and data; retry survives reload', async ({ page }) => {
  const original = appData([item(0)]), replacement = appData([item(0, { memo: '복원 😀' })]);
  await startApp(page, original);
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await openRestore(page, replacement);
  await expect(page.locator('[data-restore="apply"]')).toBeDisabled();
  await mode(page, 'replace');
  await page.locator('[data-restore="cancel"]').click();
  expect(await storage(page)).toEqual(original);
  await expect(page.locator('#session-name')).toHaveText('별도');
  await openRestore(page, replacement);
  await mode(page, 'replace');
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator('[data-restore="apply"]').click();
  await expect(page.locator('.restore-feedback')).toContainText('복원하지 못했습니다');
  expect(await storage(page)).toEqual(original);
  await expect(page.locator('#session-name')).toHaveText('별도');
  await page.evaluate(() => { window.__failSave = false; });
  await apply(page);
  expect(await storage(page)).toEqual(replacement);
  await expect(page.locator('#session-name')).toHaveText('운동');
  expect(await page.evaluate(() => window.__themeAccess)).toEqual([]);
  await page.reload();
  expect(await storage(page)).toEqual(replacement);
  await expect(page.locator('.record-row')).toHaveCount(1);
});

test('replacement opens the latest date regardless of the backup key order', async ({ page }) => {
  await startApp(page);
  const replacement = { version: 2, sessionsByDate: {
    '2026-10-09': [{ name: '최신', records: [item(0, { timestamp: Date.parse('2026-10-09T12:00:00+09:00') })] }],
    '2026-10-06': [{ name: '이전', records: [] }],
    [date]: [{ records: [] }],
  } };
  await openRestore(page, replacement); await mode(page, 'replace'); await apply(page);
  await expect(page.locator('#date-filter')).toHaveValue('2026-10-09');
  await expect(page.locator('#session-name')).toHaveText('최신');
  expect(await storage(page)).toEqual(replacement);
});

test('a backup with no dates clears saved records and opens an empty session today', async ({ page }) => {
  await startApp(page);
  const empty = { version: 2, sessionsByDate: {} };
  await openRestore(page, empty); await mode(page, 'replace'); await apply(page);
  expect(await storage(page)).toEqual(empty);
  await expect(page.locator('#date-filter')).toHaveValue(date);
  await expect(page.locator('#session-name')).toHaveText('세션 1');
  await expect(page.locator('.record-row')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.record-row')).toHaveCount(0);
});

for (const restoreMode of ['replace', 'merge']) {
  test('identical ' + restoreMode + ' does not write to storage', async ({ page }) => {
    const original = appData([item(0)]);
    await startApp(page, original);
    await openRestore(page, original); await mode(page, restoreMode); await apply(page);
    await expect(page.locator('#status')).toHaveText('변경할 데이터가 없습니다.');
    expect(await page.evaluate(() => window.__writes)).toBe(0);
    expect(await storage(page)).toEqual(original);
  });
}

test('failed restore retains a pending save; successful restore cancels it', async ({ page }) => {
  await startApp(page);
  await page.clock.pauseAt(new Date(start + 60_000));
  await page.locator('.record-row input[data-field="dataMb"]').fill('10');
  const replacement = appData([item(0, { dataMb: 99 })]);
  await openRestore(page, replacement); await mode(page, 'replace');
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator('[data-restore="apply"]').click();
  await expect(page.locator('.restore-feedback')).toContainText('복원하지 못했습니다');
  await page.evaluate(() => { window.__failSave = false; });
  await page.clock.runFor(350);
  expect((await storage(page)).sessionsByDate[date][0].records[0].dataMb).toBe(10);
  await page.locator('[data-restore="cancel"]').click();
  await page.locator('.record-row input[data-field="dataMb"]').fill('20');
  await openRestore(page, replacement); await mode(page, 'replace'); await apply(page);
  const writes = await page.evaluate(() => window.__writes);
  await page.clock.runFor(1000);
  expect(await storage(page)).toEqual(replacement);
  expect(await page.evaluate(() => window.__writes)).toBe(writes);
});

test('merge retries preserve the selected session and reset filters only after successful saving', async ({ page }) => {
  const original = appData([]), incoming = appData([]);
  incoming.sessionsByDate[date][1].records.push(item(0, { result: 'success' }));
  await startApp(page, original);
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await page.locator('[data-filter="fail"]').click();
  await openRestore(page, incoming); await mode(page, 'merge');
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator('[data-restore="apply"]').click();
  await expect(page.locator('.restore-feedback')).toContainText('복원하지 못했습니다');
  expect(await storage(page)).toEqual(original);
  await expect(page.locator('[data-filter="fail"]')).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => { window.__failSave = false; });
  await apply(page);
  await expect(page.locator('#date-filter')).toHaveValue(date);
  await expect(page.locator('#session-name')).toHaveText('별도');
  await expect(page.locator('[data-filter="all"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.record-row')).toHaveCount(1);
  expect(await storage(page)).toEqual(incoming);
});

test('invalid file reselection and read rejection clear the previously valid candidate', async ({ page }) => {
  await startApp(page);
  const before = await storage(page);
  await openRestore(page, appData([item(1)]));
  await page.locator('#backup-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('.restore-feedback')).toContainText('JSON 파일을 읽을 수 없습니다');
  await expect(page.locator('[data-restore="apply"]')).toBeDisabled();
  await expect(page.locator('.restore-file-meta')).toHaveCount(0);
  await page.evaluate(() => { File.prototype.text = () => Promise.reject(new Error('읽기 실패')); });
  await page.locator('#backup-file').setInputFiles(payload(appData([])));
  await expect(page.locator('.restore-feedback')).toHaveText('읽기 실패');
  await expect(page.locator('[data-restore="apply"]')).toBeDisabled();
  expect(await storage(page)).toEqual(before);
});

test('1000 conflicts render lazily and choices persist across pages and bulk selection', async ({ page }) => {
  test.setTimeout(60_000);
  const original = appData(Array.from({ length: 1000 }, (_, i) => item(i)));
  const incoming = appData(original.sessionsByDate[date][0].records.map((r) => ({
    ...r, id: 'backup-' + r.id, timestamp: r.timestamp + 999, result: 'success', memo: '<img src=x onerror="window.__injected=true">\n긴 메모 😀',
  })));
  await startApp(page, original);
  await openRestore(page, incoming, '<unsafe>.json'); await mode(page, 'merge');
  await expect(page.locator('.restore-file-meta')).toContainText('<unsafe>.json');
  await expect(page.locator('.restore-comparison')).toHaveCount(0);
  await page.getByText('기록 비교 1000개 · 미해결 1000개', { exact: true }).click();
  await expect(page.locator('summary').filter({ hasText: /^백업 \d+번/ })).toHaveCount(25);
  await page.locator('summary').filter({ hasText: /^백업 1번/ }).click();
  const side = (index) => page.locator(`select[data-focus-key="${date}/0/record/${index}/side"]`);
  await side(0).selectOption('backup');
  await expect(page.locator('.restore-comparison')).toHaveCount(1);
  await expect(page.locator('.restore-preview img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  await page.getByRole('button', { name: '다음 25개', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^백업 26번/ }).click();
  await side(25).selectOption('current');
  await page.getByRole('button', { name: '이전 25개', exact: true }).click();
  await expect(side(0)).toHaveValue('backup');
  await page.getByRole('button', { name: '미선택 항목 모두 현재 기록 유지', exact: true }).click();
  await expect(page.locator('[data-restore="apply"]')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    const size = await page.locator('#restore-dialog > article').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, viewport: innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
    expect(size.client).toBeLessThanOrEqual(size.viewport);
  }
  await apply(page);
  const expected = structuredClone(original);
  expected.sessionsByDate[date][0].records[0] = { ...incoming.sessionsByDate[date][0].records[0], id: 'current-0' };
  expect(await storage(page)).toEqual(expected);
  expect(await page.evaluate(() => window.__themeAccess)).toEqual([]);
});

test('changing targets or app data invalidates previous conflict choices', async ({ page }) => {
  await startApp(page);
  await openRestore(page, appData([item(0, { dataMb: 9 })])); await mode(page, 'merge');
  await page.getByRole('button', { name: '미선택 항목 모두 현재 기록 유지', exact: true }).click();
  const target = page.locator(`select[data-focus-key="${date}/0/target"]`);
  await target.selectOption('1'); await target.selectOption('0');
  await expect(page.locator('[data-restore="apply"]')).toBeDisabled();
  await page.getByRole('button', { name: '미선택 항목 모두 현재 기록 유지', exact: true }).click();
  await page.locator('.record-row input[data-field="dataMb"]').evaluate((input) => {
    input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-restore="apply"]').click();
  await expect(page.locator('.restore-feedback')).toContainText('미리보기 이후 현재 데이터가 바뀌었습니다');
  await expect(page.locator('[data-restore="apply"]')).toBeDisabled();
  await page.getByRole('button', { name: '미선택 항목 모두 백업 기록 적용', exact: true }).click();
  await apply(page);
  expect((await storage(page)).sessionsByDate[date][0].records[0].dataMb).toBe(9);
});

test('late file reads cannot replace a newer candidate or reopen a cancelled dialog', async ({ page }) => {
  await startApp(page);
  const before = await storage(page);
  await page.evaluate(() => {
    window.__fileReads = [];
    const original = File.prototype.text;
    File.prototype.text = function() { return new Promise((resolve) => window.__fileReads.push(() => original.call(this).then(resolve))); };
  });
  await openDialog(page);
  await page.locator('#backup-file').setInputFiles(payload(appData([]), 'older.json'));
  await page.locator('#backup-file').setInputFiles(payload(appData([item(1)]), 'newer.json'));
  await page.evaluate(() => window.__fileReads[1]());
  await expect(page.locator('.restore-file-meta')).toContainText('newer.json');
  await page.evaluate(() => window.__fileReads[0]());
  await expect(page.locator('.restore-file-meta')).toContainText('newer.json');
  await page.locator('#backup-file').setInputFiles(payload(appData([]), 'cancelled.json'));
  await page.keyboard.press('Escape');
  await expect(page.locator('#restore-dialog')).not.toBeVisible();
  await page.evaluate(() => window.__fileReads[2]());
  await expect(page.locator('.restore-file-meta')).toHaveCount(0);
  await expect(page.getByLabel('더보기 메뉴', { exact: true })).toBeFocused();
  expect(await storage(page)).toEqual(before);
});
