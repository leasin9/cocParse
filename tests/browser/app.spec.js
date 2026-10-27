import { test, expect } from '@playwright/test';
import { demoSnapshot } from '../../public/core.js';

async function importJSON(page, value) {
  await page.locator('.heading-actions [data-action="import"]').click();
  await page.locator('#import-text').fill(typeof value === 'string' ? value : JSON.stringify(value));
  await page.getByRole('button', { name: '解析并保存' }).click();
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('close', () => expect(errors).toEqual([]));
  await page.goto('./');
});

test('empty state and demo cover both villages without saving fictional accounts', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '暂无账号' })).toBeVisible();
  await page.getByRole('button', { name: '先看看示例' }).click();
  await expect(page.getByRole('heading', { name: 'Blue Horizon' })).toBeVisible();
  await expect(page.locator('.upgrade-row')).toHaveCount(7);
  await expect(page.locator('.boost-pill')).toHaveCount(3);
  await page.getByRole('tab', { name: '夜世界' }).click();
  await expect(page.locator('.upgrade-row')).toHaveCount(2);
  await expect(page.locator('.boost-pill')).toHaveCount(2);
  await expect(page.locator('.metric-label').filter({ hasText: '建筑大师大本营' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cocparse.accounts.v1'))).toBeNull();
  await expect(page.getByRole('button', { name: '导出备份' })).toBeDisabled();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
});

test('imports, renames, persists, and protects newer data from stale exports', async ({ page }) => {
  const snapshot = { ...demoSnapshot(), tag: '#LIVE123' };
  await importJSON(page, snapshot);
  await expect(page.getByRole('heading', { name: '#LIVE123' })).toBeVisible();
  await page.getByRole('button', { name: '设置别名' }).click();
  await page.getByLabel('账号别名', { exact: true }).fill('主号 <测试>');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '主号 <测试>' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '主号 <测试>' })).toBeVisible();
  await importJSON(page, { tag: '#LIVE123', timestamp: snapshot.timestamp - 100, buildings: [{ data: 1000001, lvl: 1 }] });
  await expect(page.locator('#toast')).toContainText('跳过旧数据 1 个');
  expect(await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('cocparse.accounts.v1')).accounts[0].rawJSON).buildings[0].lvl)).toBe(16);
  await importJSON(page, { ...snapshot, timestamp: snapshot.timestamp + 1 });
  await expect(page.locator('#toast')).toContainText('更新 1 个');
  await expect(page.locator('#account-list .account')).toHaveCount(1);
});

test('invalid batch is atomic and a valid file can be imported afterwards', async ({ page }) => {
  await importJSON(page, [demoSnapshot(), { tag: '#BROKEN' }]);
  await expect(page.locator('#import-error')).toContainText('timestamp');
  expect(await page.evaluate(() => localStorage.getItem('cocparse.accounts.v1'))).toBeNull();
  await page.locator('#import-file').setInputFiles({ name: 'account.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(demoSnapshot())) });
  await expect(page.locator('#file-name')).toHaveText('account.json');
  await page.getByRole('button', { name: '解析并保存' }).click();
  await expect(page.getByRole('heading', { name: '#DEMO' })).toBeVisible();
});

test('backup download restores names, data and multiple accounts after deletion', async ({ page }) => {
  await importJSON(page, [demoSnapshot(), { ...demoSnapshot(), tag: '#SECOND' }]);
  await page.getByRole('button', { name: '设置别名' }).click();
  await page.locator('#alias-input').fill('副号');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  const download = await downloadEvent;
  const backupPath = await download.path();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '删除账号', exact: true }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
  }
  await expect(page.getByRole('heading', { name: '暂无账号' })).toBeVisible();
  await page.locator('.heading-actions [data-action="import"]').click();
  await page.locator('#import-file').setInputFiles(backupPath);
  await page.getByRole('button', { name: '解析并保存' }).click();
  await expect(page.locator('#account-list .account')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '副号' })).toBeVisible();
});

test('real-time countdown completes and moves between filters', async ({ page }) => {
  await page.clock.install();
  await importJSON(page, { tag: '#TIMER', timestamp: Math.floor(Date.now() / 1000), buildings: [{ data: 1000008, lvl: 5, timer: 5 }] });
  await expect(page.locator('.upgrade-row')).toHaveCount(1);
  await page.clock.fastForward(7000);
  await expect(page.locator('.upgrade-row')).toHaveCount(0);
  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.locator('.upgrade-row')).toHaveCount(1);
  await expect(page.locator('.done-time')).toHaveText('已完成');
});

test('English language persists and raw export remains accessible', async ({ page }) => {
  await page.getByRole('button', { name: '先看看示例' }).click();
  await page.locator(page.viewportSize().width <= 760 ? '.tabbar [data-action="settings"]' : '.sidebar-tools [data-action="settings"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'cocParse', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'View raw JSON' }).click();
  await expect(page.locator('.raw-json')).toContainText('builder_boost');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No Accounts' })).toBeVisible();
});

test('corrupt storage is preserved until reset is explicitly confirmed', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('cocparse.accounts.v1', 'corrupted-original'));
  await page.reload();
  await expect(page.locator('.error-notice')).toContainText('已暂停写入');
  await importJSON(page, demoSnapshot());
  await expect(page.locator('#toast')).toContainText('请先备份');
  expect(await page.evaluate(() => localStorage.getItem('cocparse.accounts.v1'))).toBe('corrupted-original');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('button', { name: '确认重置' }).click();
  await expect(page.locator('.error-notice')).toHaveCount(0);
  await importJSON(page, demoSnapshot());
  await expect(page.getByRole('heading', { name: '#DEMO' })).toBeVisible();
});

test('storage failure does not claim an import was saved', async ({ page }) => {
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await importJSON(page, demoSnapshot());
  await expect(page.locator('#toast')).toContainText('保存失败');
  await expect(page.locator('#dialog')).toBeVisible();
  await expect(page.locator('#account-list .account')).toHaveCount(0);
});

test('cached application reopens offline with saved accounts', async ({ page, context }) => {
  await importJSON(page, demoSnapshot());
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => caches.keys())).toContain('cocparse-web-v2');
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '#DEMO' })).toBeVisible();
  await context.setOffline(false);
});

test('alerts fire once at the upgrade lead time and clock tower cooldown', async ({ page }) => {
  const instant = new Date('2026-10-27T08:00:00Z');
  await page.clock.install({ time: instant });
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    window.receivedAlerts = [];
    // Test scheduling independently of the host OS notification service.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    Notification.requestPermission = async () => 'granted';
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) { window.receivedAlerts.push({ title, body: options.body }); };
  });
  await importJSON(page, { tag: '#ALERTS', timestamp: instant.getTime() / 1000, buildings: [{ data: 1000008, timer: 20 }], boosts: { clocktower_cooldown: 15 } });
  await page.getByRole('button', { name: '开启提醒', exact: true }).click();
  await expect(page.getByRole('button', { name: '提醒已开启', exact: true })).toBeVisible();
  await page.clock.fastForward(13000);
  await expect.poll(() => page.evaluate(() => receivedAlerts.length)).toBe(1);
  expect(await page.evaluate(() => receivedAlerts[0].body)).toContain('加农炮');
  await page.clock.fastForward(4000);
  await expect.poll(() => page.evaluate(() => receivedAlerts.length)).toBe(2);
  expect(await page.evaluate(() => receivedAlerts[1].body)).toContain('时钟塔');
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => receivedAlerts.length)).toBe(2);
  await page.getByRole('button', { name: '提醒已开启', exact: true }).click();
  await expect(page.getByRole('button', { name: '开启提醒', exact: true })).toBeVisible();
});

test('cocParse branding and system dark mode work at narrow and wide sizes', async ({ page }) => {
  await expect(page).toHaveTitle('cocParse · 部落冲突账号管理');
  expect(await page.evaluate(async () => (await (await fetch('./manifest.webmanifest')).json()).name)).toBe('cocParse');
  await page.getByRole('button', { name: '先看看示例' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'cocParse', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 242, 247)');
});

test('mobile toolbar opens account search, switches accounts and reaches settings', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The desktop uses its persistent sidebar.');
  await importJSON(page, [{ ...demoSnapshot(), tag: '#ONE' }, { ...demoSnapshot(), tag: '#TWO' }]);
  await page.locator('.tabbar [data-action="accounts"]').click();
  await page.getByRole('dialog').getByLabel('搜索账号', { exact: true }).fill('#ONE');
  await expect(page.locator('#sheet-account-list .account')).toHaveCount(1);
  await page.locator('#sheet-account-list .account').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '#ONE', exact: true })).toBeVisible();
  await page.locator('.tabbar [data-action="import"]').click();
  await expect(page.locator('#import-text')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.tabbar [data-action="settings"]').click();
  await expect(page.getByRole('dialog').getByText('cocParse', { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: /导出备份/ }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/^cocParse-backup-/);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.tabbar [data-action="accounts"]')).toHaveAttribute('aria-current', 'true');
});
