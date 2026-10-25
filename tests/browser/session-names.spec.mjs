import { test, expect, date, startApp, storage } from './helpers.mjs';

test('session add, rename, delete and reload use the same automatic name rules', async ({ page }) => {
  await startApp(page, { version: 2, sessionsByDate: { [date]: [{ name: '세션 2', records: [] }] } });
  const rename = async (name, close = true) => {
    await page.getByRole('button', { name: '세션 관리', exact: true }).click();
    await page.getByLabel('세션 이름', { exact: true }).fill(name);
    await page.locator('#session-name-form').getByRole('button', { name: '저장', exact: true }).click();
    if (close) await page.locator('#session-dialog').getByRole('button', { name: '닫기', exact: true }).click();
  };
  await page.getByRole('button', { name: '세션 추가', exact: true }).click();
  await expect(page.locator('#session-name')).toHaveText('세션 3');
  await page.getByRole('button', { name: '세션 추가', exact: true }).click();
  await expect(page.locator('#session-name')).toHaveText('세션 4');
  await page.getByRole('button', { name: '이전 세션', exact: true }).click();
  await rename('  운동  ');
  await expect(page.locator('#session-name')).toHaveText('운동');
  await page.getByRole('button', { name: '세션 관리', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-action="delete-session"]').click();
  await expect(page.locator('#session-name')).toHaveText('세션 3');
  await rename('세션 2', false);
  await expect(page.locator('#session-dialog')).toContainText('이미 사용 중');
  await page.getByLabel('세션 이름', { exact: true }).fill('다른 이름');
  await page.locator('#session-name-form').getByRole('button', { name: '저장', exact: true }).click();
  await page.locator('#session-dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await rename('세션 3');
  expect((await storage(page)).sessionsByDate[date][1]).not.toHaveProperty('name');
  await page.reload();
  await page.getByRole('button', { name: '다음 세션', exact: true }).click();
  await expect(page.locator('#session-name')).toHaveText('세션 3');
  expect((await storage(page)).sessionsByDate[date]).toEqual([{ name: '세션 2', records: [] }, { records: [] }]);
});
