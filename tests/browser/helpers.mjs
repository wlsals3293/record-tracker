import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors).toEqual([]);
  },
});
export const date = '2026-10-07';
export const start = Date.parse(date + 'T12:00:00+09:00');
export const item = (index, extra = {}) => ({
  id: 'current-' + index, timestamp: start + index * 1000,
  result: null, dataMb: index, lengthSeconds: null, ...extra,
});
export const appData = (records = [], name = '운동') => ({
  version: 2, sessionsByDate: { [date]: [{ name, records }, { name: '별도', records: [] }] },
});
export const payload = (data, name = 'test-backup.json') => ({
  name, mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    format: 'record-tracker-backup', backupVersion: 1,
    createdAt: '2026-10-08T00:00:00.000Z', data,
  })),
});

export async function startApp(page, data = appData([item(0)])) {
  await page.clock.install({ time: new Date(start) });
  await page.addInitScript((seed) => {
    if (!sessionStorage.getItem('test-seeded')) {
      localStorage.setItem('record-tracker-data', JSON.stringify(seed));
      localStorage.setItem('rt-theme', 'dark');
      sessionStorage.setItem('test-seeded', 'yes');
    }
    window.__failSave = false;
    window.__writes = 0;
    window.__themeAccess = [];
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function(key) {
      if (key === 'rt-theme') window.__themeAccess.push('get');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'rt-theme') window.__themeAccess.push('set');
      if (key === 'record-tracker-data') {
        window.__writes++;
        if (window.__failSave) throw new DOMException('Test quota', 'QuotaExceededError');
      }
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (key === 'rt-theme') window.__themeAccess.push('remove');
      return remove.call(this, key);
    };
  }, data);
  await page.goto('./');
  await expect(page.locator('#date-filter')).toHaveValue(date);
  await page.evaluate(() => { window.__themeAccess = []; window.__writes = 0; });
}

export const storage = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('record-tracker-data')));
export async function openDialog(page) {
  await page.getByLabel('더보기 메뉴', { exact: true }).click();
  await page.getByRole('menuitem', { name: '백업 파일 복원', exact: true }).click();
}
export async function openRestore(page, data, name) {
  await openDialog(page);
  await page.locator('#backup-file').setInputFiles(payload(data, name));
  await expect(page.locator('.restore-file-meta')).toBeVisible();
}
export const mode = (page, value) => page.locator('input[name="restore-mode"][value="' + value + '"]').check();
export async function apply(page) {
  await page.locator('[data-restore="apply"]').click();
  await expect(page.locator('#restore-dialog')).not.toBeVisible();
}
