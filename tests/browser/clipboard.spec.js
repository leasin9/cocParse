import { test, expect } from '@playwright/test';
import { demoSnapshot, importAccounts, makeBackup, parseImport } from '../../public/core.js';

const savedAccounts = page => page.evaluate(() => JSON.parse(localStorage.getItem('cocparse.accounts.v1') ?? '{"accounts":[]}').accounts);
const activate = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const setClipboard = (page, text) => page.evaluate(value => { window.clipboardMock.text = value; }, typeof text === 'string' ? text : JSON.stringify(text));
const openSettings = page => page.locator(page.viewportSize().width <= 760 ? '.heading-actions [data-action="settings"]' : '.sidebar-tools [data-action="settings"]').click();

async function boot(page, text, options = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('close', () => expect(errors).toEqual([]));
  await page.addInitScript(({ text, options }) => {
    window.clipboardMock = { text, denied: options.denied ?? false, calls: 0, deferred: false, resolve: null };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: async () => {
        clipboardMock.calls++;
        if (clipboardMock.denied) throw new DOMException('Permission denied', 'NotAllowedError');
        if (clipboardMock.deferred) return new Promise(resolve => { clipboardMock.resolve = resolve; });
        return clipboardMock.text;
      },
      writeText: async value => { clipboardMock.text = value; },
    } });
  }, { text: typeof text === 'string' ? text : JSON.stringify(text), options });
  await page.goto('./');
  await expect.poll(() => page.evaluate(() => clipboardMock.calls)).toBeGreaterThan(0);
}

test('imports on opening, deduplicates on return and reload, and imports newer clipboard data', async ({ page }) => {
  const snapshot = { ...demoSnapshot(), tag: '#AUTO' };
  await boot(page, snapshot);
  await expect(page.getByRole('heading', { name: '#AUTO', exact: true })).toBeVisible();
  await activate(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '#AUTO', exact: true })).toBeVisible();
  await expect.poll(async () => (await savedAccounts(page))[0]?.updateCount).toBe(1);
  await setClipboard(page, { ...snapshot, timestamp: snapshot.timestamp + 1 });
  await activate(page);
  await expect.poll(async () => (await savedAccounts(page))[0]?.updateCount).toBe(2);
  await setClipboard(page, { tag: '#AUTO', timestamp: snapshot.timestamp - 100 });
  await activate(page);
  expect((await savedAccounts(page))[0].updateCount).toBe(2);
});

test('denied permission stays quiet and Import retries during the user action', async ({ page }) => {
  await boot(page, { ...demoSnapshot(), tag: '#RETRY' }, { denied: true });
  await expect(page.getByRole('heading', { name: '暂无账号', exact: true })).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden();
  const deniedCalls = await page.evaluate(() => clipboardMock.calls);
  await activate(page);
  expect(await page.evaluate(() => clipboardMock.calls)).toBe(deniedCalls);
  await page.evaluate(() => { clipboardMock.denied = false; });
  await page.locator('.heading-actions [data-action="import"]').click();
  await expect(page.getByRole('heading', { name: '#RETRY', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('unrelated clipboard text is ignored and the page remains usable', async ({ page }) => {
  await boot(page, 'unrelated personal clipboard text');
  await expect(page.getByRole('heading', { name: '暂无账号', exact: true })).toBeVisible();
  expect(await savedAccounts(page)).toHaveLength(0);
  await expect(page.locator('#toast')).toBeHidden();
  await page.getByRole('button', { name: '先看看示例' }).click();
  await expect(page.getByRole('heading', { name: 'Blue Horizon' })).toBeVisible();
});

test('full backups require manual import rather than automatic restore', async ({ page }) => {
  const accounts = importAccounts([], parseImport(JSON.stringify(demoSnapshot()))).accounts;
  await boot(page, makeBackup(accounts));
  expect(await savedAccounts(page)).toHaveLength(0);
  await page.locator('.heading-actions [data-action="import"]').click();
  await expect(page.locator('#import-text')).toBeVisible();
  await page.getByRole('button', { name: '从剪贴板粘贴', exact: true }).click();
  await page.getByRole('button', { name: '解析并保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '#DEMO', exact: true })).toBeVisible();
});

test('automatic reads do not interrupt an import draft', async ({ page }) => {
  await boot(page, '');
  await page.locator('.heading-actions [data-action="import"]').click();
  await page.locator('#import-text').fill('unfinished draft');
  await setClipboard(page, demoSnapshot());
  await activate(page);
  await expect(page.locator('#import-text')).toHaveValue('unfinished draft');
  expect(await savedAccounts(page)).toHaveLength(0);
});

test('a delayed read is discarded if the user opens a dialog in the meantime', async ({ page }) => {
  await boot(page, '');
  await page.evaluate(() => { clipboardMock.deferred = true; });
  await activate(page);
  await expect.poll(() => page.evaluate(() => !!clipboardMock.resolve)).toBe(true);
  await page.locator('.heading-actions [data-action="import"]').click();
  await page.locator('#import-text').fill('my draft');
  await page.evaluate(text => { clipboardMock.resolve(text); clipboardMock.deferred = false; }, JSON.stringify(demoSnapshot()));
  await expect(page.locator('#import-text')).toHaveValue('my draft');
  expect(await savedAccounts(page)).toHaveLength(0);
});

test('automatic reading can be disabled persistently and re-enabled from Settings', async ({ page }) => {
  await boot(page, '');
  await openSettings(page);
  const toggle = page.getByRole('switch', { name: '自动读取剪贴板', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await setClipboard(page, demoSnapshot());
  const calls = await page.evaluate(() => clipboardMock.calls);
  await activate(page);
  expect(await page.evaluate(() => clipboardMock.calls)).toBe(calls);
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂无账号', exact: true })).toBeVisible();
  expect(await page.evaluate(() => clipboardMock.calls)).toBe(0);
  await openSettings(page);
  await expect(toggle).not.toBeChecked();
  await page.evaluate(text => { clipboardMock.text = text; }, JSON.stringify(demoSnapshot()));
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await savedAccounts(page)).length).toBe(1);
  await expect(page.getByRole('dialog')).toBeVisible();
});
