import { BOOSTS, STORAGE_KEY, demoSnapshot, formatDuration, hallLevel, importAccounts, importClipboard, itemName, loadAccounts, makeBackup, parseImport, saveAccounts, scanUpgrades } from './core.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const paths = {
  castle: '<path d="M3 21V9h4V4h3v5h4V4h3v5h4v12H3Z"/><path d="M9 21v-6a3 3 0 0 1 6 0v6M3 13h4m10 0h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="m7 17 10-10M7 7h10v10"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="m3 10 9-7 9 7v11H3V10Z"/><path d="M9 21v-8h6v8"/>',
  moon: '<path d="M20.8 14a9 9 0 0 1-10.9-10.8A9 9 0 1 0 20.8 14Z"/><path d="m18 3 .7 2.3L21 6l-2.3.7L18 9l-.7-2.3L15 6l2.3-.7L18 3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', edit: '<path d="m15 4 5 5M3 21l2-7L16 3l5 5L10 19l-7 2Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>', bell: '<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4Zm5 3h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>', shield: '<path d="m12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/>', crown: '<path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7Zm2 15h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  settings: '<path d="m9 3-.5 3-2 .9-2.7-1.1-2 3.4L4 11v2l-2.2 1.8 2 3.4 2.7-1.1 2 .9.5 3h4l.5-3 2-.9 2.7 1.1 2-3.4L18 13v-2l2.2-1.8-2-3.4-2.7 1.1-2-.9L13 3H9Z"/><circle cx="11" cy="12" r="3"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.grid}</svg>`;
let language;
try { language = localStorage.getItem('cocparse.language') || (navigator.language.startsWith('zh') ? 'zh' : 'en'); } catch { language = 'zh'; }
if (!['zh', 'en'].includes(language)) language = 'zh';
const state = { accounts: [], selected: null, language, village: 'home', filter: 'active', search: '', demo: false, storageError: false };
const t = (zh, en) => state.language === 'zh' ? zh : en;
const duration = seconds => formatDuration(seconds, state.language);
const date = (value, full = false) => new Date(value).toLocaleString(state.language === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(full ? { year: 'numeric' } : {}) });
const displayName = account => account.alias || account.tag;
const demo = { tag: '#DEMO', alias: 'Blue Horizon', rawJSON: JSON.stringify(demoSnapshot()), updateCount: 1, firstRecorded: Date.now(), lastUpdated: Date.now(), notifyEnabled: false };
const selectedAccount = () => state.demo ? demo : state.accounts.find(account => account.tag === state.selected);
const snapshotCache = new WeakMap();
const snapshotOf = account => {
  const cached = snapshotCache.get(account);
  if (cached?.raw === account.rawJSON) return cached.snapshot;
  const snapshot = JSON.parse(account.rawJSON);
  snapshotCache.set(account, { raw: account.rawJSON, snapshot });
  return snapshot;
};
const allUpgrades = (snapshot, now = Date.now()) => [...scanUpgrades(snapshot, 'home', now), ...scanUpgrades(snapshot, 'builder', now)];
let toastTimer;
let completionSignature = '';
let pendingNotifications = new Map();
let registration;
let dialogRevision = 0;
let clipboardReading = false;
let clipboardBlocked = false;
let autoClipboard = true;
try { autoClipboard = localStorage.getItem('cocparse.autoClipboard') !== 'false'; } catch { /* Use the default for this visit. */ }
try { state.accounts = loadAccounts(localStorage); state.selected = state.accounts[0]?.tag ?? null; } catch { state.storageError = true; }

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.textContent = message;
  element.className = error ? 'error' : '';
  element.hidden = false;
  const dialog = $('#dialog');
  dialog.querySelector('.dialog-notice')?.remove();
  if (dialog.open) {
    const inline = document.createElement('p');
    inline.className = `dialog-notice ${error ? 'form-error' : 'field-hint'}`;
    inline.setAttribute('role', 'status');
    inline.textContent = message;
    dialog.querySelector('.dialog-body').append(inline);
  }
  toastTimer = setTimeout(() => { element.hidden = true; dialog.querySelector('.dialog-notice')?.remove(); }, 5000);
}
function persist(accounts) {
  if (state.storageError) { toast(t('请先备份并处理无法读取的本地存档。', 'Back up and reset the unreadable local data first.'), true); return false; }
  try { saveAccounts(localStorage, accounts); state.accounts = accounts; rebuildNotifications(); return true; }
  catch { toast(t('保存失败：浏览器存储不可用或空间不足。原数据未被修改，请先导出备份。', 'Could not save: storage is unavailable or full. Existing data is unchanged. Export a backup first.'), true); return false; }
}
function renderAccounts(search = state.search) {
  const term = search.trim().toLowerCase();
  const visible = state.accounts.filter(account => `${account.alias} ${account.tag}`.toLowerCase().includes(term));
  return visible.length ? visible.map(account => {
    const snapshot = snapshotOf(account);
    const count = allUpgrades(snapshot).filter(upgrade => upgrade.remaining > 0).length;
    return `<button class="account ${!state.demo && account.tag === state.selected ? 'selected' : ''}" data-action="select" data-tag="${esc(account.tag)}" aria-pressed="${!state.demo && account.tag === state.selected}"><span class="account-hall">${icon('castle')}<small>${hallLevel(snapshot)}</small></span><span class="account-info"><strong>${esc(displayName(account))}</strong><small>${esc(account.tag)}</small></span><span class="account-count" title="${t('升级进行中', 'Active upgrades')}">${count}</span></button>`;
  }).join('') : `<p class="sidebar-empty">${state.accounts.length ? t('没有匹配的账号', 'No matching accounts') : t('导入你的第一个账号，\n开始记录部落日常。', 'Import your first account\nto start your village journal.')}</p>`;
}
function render() {
  document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
  document.title = t('cocParse · 部落冲突账号管理', 'cocParse · Clash of Clans accounts');
  const account = selectedAccount();
  $('#app').innerHTML = `<div class="app-layout"><aside class="sidebar">
    <div class="sidebar-section"><span>${t('我的账号', 'My accounts')}</span><button class="icon-button" data-action="import" aria-label="${t('添加账号', 'Add account')}">${icon('plus')}</button></div>
    <label class="search-box">${icon('search')}<input id="account-search" type="search" placeholder="${t('搜索账号', 'Search accounts')}" aria-label="${t('搜索账号', 'Search accounts')}" value="${esc(state.search)}"></label>
    <nav id="account-list" aria-label="${t('账号列表', 'Accounts')}">${renderAccounts()}</nav>
    <div class="sidebar-tools"><button data-action="settings">${icon('settings')}${t('设置', 'Settings')}</button></div></aside>
    <main class="main"><div class="workspace"><header class="page-heading"><h1>cocParse</h1><div class="heading-actions"><button class="icon-button" data-action="settings" aria-label="${t('设置', 'Settings')}">${icon('settings')}</button><button class="button primary" data-action="import">${icon('plus')}<span>${t('导入', 'Import')}</span></button></div></header>
    ${state.storageError ? `<div class="notice error-notice">${icon('info')}<span>${t('本地存档无法读取，已暂停写入。', 'Local data could not be read. Saving is paused.')}</span><button data-action="recover">${t('下载原存档', 'Download original')}</button><button data-action="reset">${t('重置', 'Reset')}</button></div>` : ''}
    ${account ? renderDetail(account) : renderEmpty()}</div></main></div>`;
  completionSignature = currentSignature();
  tickCountdowns();
}
function renderEmpty() {
  return `<section class="empty-state">${icon('castle')}<h2>${t('暂无账号', 'No Accounts')}</h2><p>${t('导入游戏 JSON，查看升级进度。', 'Import a game JSON to track your upgrades.')}</p><button class="button primary" data-action="import">${t('导入账号', 'Import account')}</button><button class="text-button" data-action="demo">${t('先看看示例', 'Explore a demo')}</button></section>`;
}
function renderDetail(account) {
  const snapshot = snapshotOf(account);
  const builder = state.village === 'builder';
  const upgrades = scanUpgrades(snapshot, state.village);
  const active = upgrades.filter(upgrade => upgrade.remaining > 0);
  const completed = upgrades.filter(upgrade => upgrade.remaining <= 0);
  const shown = state.filter === 'all' ? upgrades : state.filter === 'completed' ? completed : active;
  const hasBuilder = snapshot.buildings2?.length || snapshot.heroes2?.length || snapshot.units2?.length || snapshot.traps2?.length;
  return `<section class="account-heading"><div class="account-heading-name"><h2><button class="account-select" data-action="accounts" aria-haspopup="dialog" title="${t('切换账号', 'Switch account')}">${esc(displayName(account))}${icon('chevron')}</button></h2><div class="account-meta">${state.demo ? t('示例数据 · 不会保存', 'Demo data · Not saved') : `${account.alias ? `<span class="mono">${esc(account.tag)}</span><span>·</span>` : ''}<span>${t('导出于', 'Exported')} ${date(snapshot.timestamp * 1000)}</span>`}</div></div><button class="icon-button" data-action="account-menu" aria-label="${t('账号操作', 'Account actions')}">${icon('more')}</button></section>
    <div class="village-tabs" role="tablist" aria-label="${t('村庄', 'Village')}"><button role="tab" aria-selected="${!builder}" data-action="village" data-value="home" class="${!builder ? 'active' : ''}">${t('家乡', 'Home Village')}</button><button role="tab" aria-selected="${builder}" data-action="village" data-value="builder" class="${builder ? 'active' : ''}" ${!hasBuilder ? 'disabled' : ''}>${t('夜世界', 'Builder Base')}</button></div>
    <div class="village-summary"><span><span class="hall-label">${t(builder ? '建筑大师大本营' : '大本营', builder ? 'Builder Hall' : 'Town Hall')}</span> ${hallLevel(snapshot, builder) || '—'}</span><span>${active.length}${t(' 项升级中', ' active upgrades')}</span></div>
    ${renderBoosts(snapshot)}<section class="panel upgrades-panel"><div class="panel-heading"><h3>${t('升级', 'Upgrades')}</h3><div class="filter-group" aria-label="${t('筛选升级', 'Filter upgrades')}">${[['active', t('进行中', 'Active')], ['completed', t('已完成', 'Done')], ['all', t('全部', 'All')]].map(([value, label]) => `<button data-action="filter" data-value="${value}" aria-pressed="${state.filter === value}" class="${state.filter === value ? 'active' : ''}">${label}</button>`).join('')}</div></div>${shown.length ? `<div class="upgrade-table"><div class="table-head"><span>${t('项目', 'Upgrade')}</span><span>${t('预计完成', 'Finish time')}</span><span>${t('剩余时间', 'Time left')}</span></div>${shown.map(upgrade => renderUpgrade(upgrade)).join('')}</div>` : `<div class="no-upgrades"><h4>${state.filter === 'completed' ? t('暂无已完成的升级', 'No completed upgrades') : t('暂无进行中的升级', 'No active upgrades')}</h4></div>`}</section>
    ${renderInventory(snapshot)}<p class="record-note">${t('游戏内变化后，请重新导入最新数据。', 'Import a fresh export after making changes in the game.')}</p>`;
}
function renderUpgrade(upgrade) {
  const done = upgrade.remaining <= 0;
  return `<article class="upgrade-row ${done ? 'is-done' : ''}" data-upgrade="${upgrade.id}"><div class="upgrade-item"><strong>${esc(itemName(upgrade.data, state.language))}</strong><div class="item-level">${t('等级', 'Level')} ${upgrade.level} → ${upgrade.level + 1}</div></div><time class="finish-date" datetime="${new Date(upgrade.endTime).toISOString()}">${date(upgrade.endTime)}</time><div class="upgrade-time"><strong data-end="${upgrade.endTime}" class="${done ? 'done-time' : ''}">${duration(upgrade.remaining)}</strong><small class="game-remaining" ${!upgrade.isBoosted ? 'hidden' : ''}>${t('游戏内 ', 'In game ')}<span>${duration(upgrade.gameRemaining)}</span></small></div></article>`;
}
function renderBoosts(snapshot) {
  const keys = state.village === 'builder' ? ['clocktower_boost', 'clocktower_cooldown'] : ['builder_boost', 'lab_boost', 'pet_boost'];
  const labels = { builder_boost: t('建筑工人药水', 'Builder Potion'), lab_boost: t('研究药水', 'Research Potion'), pet_boost: t('战宠药水', 'Pet Potion'), clocktower_boost: t('时钟塔加速', 'Clock Tower boost'), clocktower_cooldown: t('时钟塔冷却', 'Clock Tower cooldown') };
  const boosts = keys.filter(key => (snapshot.boosts?.[key] ?? 0) - (Date.now() / 1000 - snapshot.timestamp) > 0);
  if (!boosts.length) return '';
  return `<details class="boost-details"><summary>${t('加速与冷却', 'Boosts & cooldowns')}<span>${boosts.length}</span>${icon('chevron')}</summary><div class="boost-bar">${boosts.map(key => `<span class="boost-pill">${labels[key]}${BOOSTS[key] ? `<b>×${BOOSTS[key].multiplier}</b>` : ''}<small data-end="${(snapshot.timestamp + snapshot.boosts[key]) * 1000}">${duration(snapshot.boosts[key] - (Date.now() / 1000 - snapshot.timestamp))}</small></span>`).join('')}</div></details>`;
}
function renderInventory(snapshot) {
  const groups = state.village === 'builder' ? ['heroes2', 'buildings2', 'traps2', 'units2'] : ['heroes', 'buildings', 'traps', 'units', 'spells', 'pets', 'siege_machines', 'equipment'];
  const labels = { heroes: t('英雄', 'Heroes'), heroes2: t('夜世界英雄', 'Builder heroes'), buildings: t('建筑', 'Buildings'), buildings2: t('夜世界建筑', 'Builder buildings'), traps: t('陷阱', 'Traps'), traps2: t('夜世界陷阱', 'Builder traps'), units: t('兵种', 'Troops'), units2: t('夜世界兵种', 'Builder troops'), spells: t('法术', 'Spells'), pets: t('战宠', 'Pets'), siege_machines: t('攻城机器', 'Siege machines'), equipment: t('英雄装备', 'Hero equipment') };
  const populated = groups.filter(group => snapshot[group]?.length);
  if (!populated.length) return '';
  return `<details class="inventory"><summary class="inventory-heading">${t('村庄详情', 'Village details')}${icon('chevron')}</summary><div class="inventory-body">${populated.map(group => `<details class="collection-group"><summary><span>${group.startsWith('heroes') ? icon('crown') : icon('grid')}${labels[group]}<small>${snapshot[group].length}</small></span><span class="details-plus">+</span></summary><div class="collection-grid">${snapshot[group].map(item => `<div class="collection-item"><strong>${esc(itemName(item.data, state.language))}</strong><span>${t('等级 ', 'Lv. ')}<b>${item.lvl ?? 0}</b>${item.cnt != null ? ` <small>×${item.cnt}</small>` : ''}${item.weapon ? ` <small>${t('武器 ', 'Weapon ')}${item.weapon}</small>` : ''}</span></div>`).join('')}</div></details>`).join('')}</div></details>`;
}
function currentSignature() {
  return [...state.accounts, ...(state.demo ? [demo] : [])].map(account => {
    const snapshot = snapshotOf(account);
    return allUpgrades(snapshot).map(upgrade => upgrade.remaining > 0 ? '1' : '0').join('') + Object.keys(snapshot.boosts ?? {}).map(key => snapshot.timestamp + snapshot.boosts[key] > Date.now() / 1000 ? '1' : '0').join('');
  }).join('|');
}
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('[data-end]').forEach(element => { element.textContent = duration((Number(element.dataset.end) - now) / 1000); });
  const account = selectedAccount();
  if (!account) return;
  for (const upgrade of scanUpgrades(snapshotOf(account), state.village, now)) {
    const row = document.querySelector(`[data-upgrade="${upgrade.id}"]`);
    if (!row) continue;
    const game = row.querySelector('.game-remaining');
    game.hidden = !upgrade.isBoosted;
    game.querySelector('span').textContent = duration(upgrade.gameRemaining);
  }
}
function openDialog(title, body, footer = '') {
  dialogRevision++;
  const dialog = $('#dialog');
  if (dialog.open) dialog.close();
  dialog.dataset.view = '';
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button muted" data-action="close" aria-label="${t('关闭', 'Close')}">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  dialog.showModal();
}
function accountsDialog() {
  openDialog(t('我的账号', 'My accounts'), `<label class="search-box sheet-search">${icon('search')}<input id="sheet-account-search" type="search" placeholder="${t('搜索名称或标签', 'Search name or tag')}" aria-label="${t('搜索账号', 'Search accounts')}"></label><nav id="sheet-account-list" class="sheet-accounts" aria-label="${t('选择账号', 'Choose an account')}">${renderAccounts('')}</nav>`, `<button class="button primary" data-action="import">${icon('plus')}${t('添加账号', 'Add account')}</button>`);
  $('#dialog').dataset.view = 'accounts';
}
function accountMenuDialog() {
  const account = selectedAccount();
  if (!account) return;
  const row = (action, label, symbol, danger = false) => `<button class="settings-row ${danger ? 'danger' : ''}" data-action="${action}"><span class="settings-symbol ${danger ? 'red' : 'blue'}">${icon(symbol)}</span><span>${label}</span>${icon('chevron')}</button>`;
  openDialog(t('账号操作', 'Account actions'), `<p class="dialog-description">${esc(displayName(account))}</p><div class="settings-group">${!state.demo ? row('rename', t('设置别名', 'Set alias'), 'edit') + row('notify', account.notifyEnabled ? t('关闭提醒', 'Disable alerts') : t('开启提醒', 'Enable alerts'), 'bell') : ''}${row('raw', t('查看原始 JSON', 'View raw JSON'), 'copy')}${state.demo ? row('exit-demo', t('退出示例', 'Exit demo'), 'close') : row('delete', t('删除账号', 'Delete account'), 'trash', true)}</div><p class="settings-note">${t('最近记录 ', 'Last recorded ')}${date(account.lastUpdated)} · ${t('更新 ', 'Updated ')}${account.updateCount}${t(' 次', ' times')}</p>`);
  $('#dialog').dataset.view = 'account-menu';
}
function settingsDialog() {
  openDialog(t('设置', 'Settings'), `<div class="settings-identity"><img src="./icon.svg" alt="" width="64" height="64"><div><strong>cocParse</strong><span>${t('部落冲突账号管理', 'Clash of Clans accounts')}</span></div></div><section class="settings-section"><h3>${t('偏好设置', 'Preferences')}</h3><div class="settings-group"><button class="settings-row" data-action="language" aria-label="${t('Switch to English', '切换到中文')}"><span class="settings-symbol purple">${icon('grid')}</span><span>${t('语言', 'Language')}</span><span class="settings-value">${t('中文', 'English')}</span>${icon('chevron')}</button><button class="settings-row" data-action="auto-clipboard" role="switch" aria-checked="${autoClipboard}" aria-label="${t('自动读取剪贴板', 'Read clipboard automatically')}"><span class="settings-symbol blue">${icon('copy')}</span><span>${t('自动读取剪贴板', 'Read clipboard automatically')}</span><span class="settings-switch ${autoClipboard ? 'is-on' : ''}" aria-hidden="true"></span></button></div><p class="settings-note">${t('打开或切回页面时自动导入游戏 JSON。部分浏览器需点击“导入”后授权。', 'Import game JSON on opening or returning to this page. Some browsers require tapping Import to allow access.')}</p></section><section class="settings-section"><h3>${t('数据管理', 'Data')}</h3><div class="settings-group"><button class="settings-row" data-action="backup" ${!state.accounts.length ? 'disabled' : ''}><span class="settings-symbol blue">${icon('download')}</span><span>${t('导出备份', 'Export backup')}</span><span class="settings-value">${state.accounts.length}${t(' 个账号', ' accounts')}</span>${icon('chevron')}</button><button class="settings-row" data-action="import"><span class="settings-symbol green">${icon('upload')}</span><span>${t('导入账号或备份', 'Import accounts or backup')}</span>${icon('chevron')}</button></div><p class="settings-note">${t('账号数据只保存在当前浏览器中。请定期导出备份。', 'Accounts stay in this browser. Export a backup regularly.')}</p></section><section class="settings-section"><h3>${t('关于', 'About')}</h3><div class="settings-group"><button class="settings-row" data-action="about"><span class="settings-symbol gray">${icon('info')}</span><span>${t('关于 cocParse', 'About cocParse')}</span><span class="settings-value">1.2</span>${icon('chevron')}</button></div></section>`, `<button class="button primary" data-action="close">${t('完成', 'Done')}</button>`);
  $('#dialog').dataset.view = 'settings';
}
function importDialog() {
  openDialog(t('导入账号', 'Import accounts'), `<p class="dialog-description">${t('粘贴游戏导出的 JSON，或上传 JSON 文件。同一标签会自动更新，较旧的导出会被跳过。', 'Paste a game export or upload a JSON file. Matching tags update automatically; older exports are skipped.')}</p><div class="import-tools"><button class="button secondary" data-action="clipboard">${icon('copy')}${t('从剪贴板粘贴', 'Paste from clipboard')}</button><label class="button secondary file-label">${icon('upload')}${t('选择文件', 'Choose file')}<input id="import-file" type="file" accept=".json,application/json,text/plain"></label></div><label class="field-label" for="import-text">${t('账号 JSON / Web 版备份', 'Account JSON / Web backup')}<span id="file-name"></span></label><textarea id="import-text" class="json-input" spellcheck="false" placeholder='{"tag":"#YOURTAG","timestamp":…}'></textarea><p class="field-hint">${t('支持单个账号、账号数组及本站导出的完整备份。文件上限 10 MB。', 'Supports one account, an account array, or a full Web backup. Maximum 10 MB.')}</p><p id="import-error" class="form-error" role="alert" hidden></p>`, `<button class="button secondary" data-action="close">${t('取消', 'Cancel')}</button><button class="button primary" data-action="import-submit">${icon('check')}${t('解析并保存', 'Parse & save')}</button>`);
  $('#dialog').dataset.view = 'import';
  if (!matchMedia('(max-width: 760px)').matches) $('#import-text').focus();
}
const errors = {
  invalidJSON: ['JSON 格式不正确，请粘贴完整的游戏导出数据。', 'Invalid JSON. Paste the complete game export.'],
  invalidSnapshot: ['未找到有效账号，请检查数据内容。', 'No valid account was found. Check the export.'],
  invalidTag: ['缺少有效的玩家标签 tag。', 'A valid player tag is required.'],
  invalidTimestamp: ['缺少有效的导出时间 timestamp（Unix 秒）。', 'A valid export timestamp (Unix seconds) is required.'],
  invalidItems: ['项目数据格式错误：类别应为数组，data、lvl、timer 等应为整数。', 'Invalid items: groups must be arrays, and data, lvl, and timer must be integers.'],
  invalidBoosts: ['加速数据格式不正确，剩余时间应为整数秒。', 'Invalid boost data. Remaining times must be integer seconds.'],
  invalidBackup: ['备份格式或版本不受支持。', 'Unsupported or invalid backup format.'],
  fileTooLarge: ['文件超过 10 MB，请拆分后导入。', 'File exceeds 10 MB. Split it before importing.'],
};
function submitImport() {
  try {
    const entries = parseImport($('#import-text').value);
    const result = importAccounts(state.accounts, entries);
    if (!persist(result.accounts)) return;
    state.demo = false; state.selected = result.selectedTag; state.village = 'home'; state.filter = 'active';
    $('#dialog').close(); render();
    toast(t(`已新增 ${result.added} 个，更新 ${result.updated} 个，跳过旧数据 ${result.skipped} 个。`, `${result.added} added, ${result.updated} updated, ${result.skipped} older exports skipped.`));
  } catch (error) { $('#import-error').textContent = t(...(errors[error.code] ?? errors.invalidSnapshot)); $('#import-error').hidden = false; }
}

async function scanClipboard({ interactive = false, allowedView = '' } = {}) {
  const dialog = $('#dialog');
  const editing = () => document.activeElement?.matches('input, textarea, [contenteditable="true"]');
  if (!autoClipboard || state.storageError || clipboardReading || !navigator.clipboard?.readText || !window.isSecureContext || document.hidden || !document.hasFocus()) return;
  if (!interactive && (clipboardBlocked || dialog.open || editing())) return;
  const revision = dialogRevision;
  clipboardReading = true;
  try {
    // Keep this call before any await so user-triggered reads retain activation.
    const text = await navigator.clipboard.readText();
    clipboardBlocked = false;
    if (!autoClipboard || revision !== dialogRevision || document.hidden || !document.hasFocus()) return;
    if (dialog.open && (!interactive || dialog.dataset.view !== allowedView)) return;
    if (allowedView === 'import' && $('#import-text')?.value.trim()) return;
    if (!interactive && editing()) return;
    const result = importClipboard(state.accounts, text);
    if (!result || !persist(result.accounts)) return;
    state.demo = false;
    state.selected = result.selectedTag;
    state.village = 'home';
    state.filter = 'active';
    if (dialog.open && allowedView === 'import') dialog.close();
    render();
    if (dialog.open && allowedView === 'settings') settingsDialog();
    toast(t(`已从剪贴板导入：新增 ${result.added} 个，更新 ${result.updated} 个。`, `Imported from clipboard: ${result.added} added, ${result.updated} updated.`));
  } catch {
    // A manual import/paste remains available when the browser requires a gesture.
    clipboardBlocked = true;
  } finally {
    clipboardReading = false;
  }
}

function toggleAutoClipboard() {
  autoClipboard = !autoClipboard;
  clipboardBlocked = false;
  let saved = true;
  try { localStorage.setItem('cocparse.autoClipboard', String(autoClipboard)); } catch { saved = false; }
  settingsDialog();
  if (!saved) toast(t('设置仅对本次访问生效，浏览器无法保存偏好。', 'This setting applies to this visit only. The browser could not save it.'), true);
  if (autoClipboard) void scanClipboard({ interactive: true, allowedView: 'settings' });
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function rawDialog() {
  const account = selectedAccount();
  if (!account) return;
  openDialog(t('原始 JSON', 'Raw JSON'), `<p class="dialog-description mono">${esc(account.tag)} · ${date(snapshotOf(account).timestamp * 1000, true)}</p><pre class="raw-json">${esc(JSON.stringify(snapshotOf(account), null, 2))}</pre>`, `<button class="button secondary" data-action="download-raw">${icon('download')}${t('下载 JSON', 'Download JSON')}</button><button class="button primary" data-action="copy-raw">${icon('copy')}${t('复制 JSON', 'Copy JSON')}</button>`);
}
function aboutDialog() {
  openDialog(t('关于 cocParse', 'About cocParse'), `<div class="about-brand">${icon('castle')}<strong>cocParse<small>1.2 · Web</small></strong></div><p>${t('从 COCRecord 原生应用迁移而来，为部落冲突玩家记录多个账号、追踪升级进度。', 'A Web adaptation of the native COCRecord app, built to track accounts and upgrade progress for Clash of Clans players.')}</p><div class="about-section"><h3>${t('数据与备份', 'Data & backups')}</h3><p>${t('账号数据仅保存在当前浏览器中，不会上传到服务器。更换设备、清理网站数据或使用隐私模式可能导致记录丢失，请定期导出备份。', 'Account data stays in this browser and is not uploaded. Export a backup before switching devices or clearing site data. Private browsing may not keep records.')}</p></div><div class="about-section"><h3>${t('提醒的工作方式', 'How alerts work')}</h3><p>${t('授权后，页面运行时会在升级结束前约 8 秒或时钟塔冷却结束时提醒。请保持页面打开；关闭页面、设备休眠或浏览器暂停运行时，无法保证准时提醒。原生快捷指令和后台定时通知不适用于此 Web 版。', 'After permission is granted, the running page alerts you about 8 seconds before an upgrade finishes, or when the Clock Tower is ready. Keep the page open; closed pages, sleep, and browser suspension cannot guarantee timely alerts. Native Shortcuts and background scheduling are not available in this Web edition.')}</p></div><div class="about-section"><h3>${t('来源与致谢', 'Source & credits')}</h3><div class="credit-links"><a href="https://codeberg.org/leasin9/COCRecord" target="_blank" rel="noreferrer">COCRecord · ${t('原项目', 'Original app')}${icon('arrow')}</a><a href="https://github.com/lemonicy/clashpost" target="_blank" rel="noreferrer">clashpost · ${t('部落驿站', 'Chinese names')}${icon('arrow')}</a><a href="https://github.com/chiefpansancolt/clash-of-clans-data" target="_blank" rel="noreferrer">clash-of-clans-data${icon('arrow')}</a><a href="https://github.com/leasin9/cocParse" target="_blank" rel="noreferrer">${t('Web 版源码', 'Web source')}${icon('arrow')}</a></div></div>`, `<button class="button primary" data-action="close">${t('知道了', 'Got it')}</button>`);
}
function renameDialog() {
  const account = selectedAccount();
  if (!account || state.demo) return;
  openDialog(t('给账号起个名字', 'Name your account'), `<p class="dialog-description mono">${esc(account.tag)}</p><label class="field-label" for="alias-input">${t('账号别名', 'Account alias')}</label><input class="text-input" id="alias-input" maxlength="80" value="${esc(account.alias)}" placeholder="${t('留空则显示玩家标签', 'Leave empty to show the player tag')}">`, `<button class="button secondary" data-action="close">${t('取消', 'Cancel')}</button><button class="button primary" data-action="rename-save">${t('保存', 'Save')}</button>`);
  $('#alias-input').focus();
}
async function toggleNotify() {
  const account = selectedAccount();
  if (!account || state.demo) return;
  if (!account.notifyEnabled) {
    if (!('Notification' in window)) { toast(t('此浏览器不支持系统通知。你仍可查看页面倒计时。', 'This browser does not support system notifications. Live timers still work.'), true); return; }
    if (await Notification.requestPermission() !== 'granted') { toast(t('通知未获授权，请检查浏览器的网站通知设置。', 'Notifications were not allowed. Check this site’s notification settings.'), true); return; }
  }
  const next = state.accounts.map(item => item.tag === account.tag ? { ...item, notifyEnabled: !item.notifyEnabled } : item);
  if (persist(next)) {
    const menuOpen = $('#dialog').open && $('#dialog').dataset.view === 'account-menu';
    render();
    if (menuOpen) accountMenuDialog();
    toast(account.notifyEnabled ? t('已关闭此账号提醒。', 'Alerts disabled for this account.') : t('提醒已开启，请保持页面打开。', 'Alerts enabled. Keep this page open.'));
  }
}
function rebuildNotifications() {
  const now = Date.now();
  const next = new Map();
  for (const account of state.accounts.filter(item => item.notifyEnabled)) {
    const snapshot = snapshotOf(account);
    const events = allUpgrades(snapshot).filter(upgrade => upgrade.remaining > 0).map(upgrade => ({ id: upgrade.id, data: upgrade.data, endTime: upgrade.endTime, due: Math.max(now + 1000, upgrade.endTime - 8000) }));
    const clockEnd = (snapshot.timestamp + (snapshot.boosts?.clocktower_cooldown ?? 0)) * 1000;
    if (clockEnd > now) events.push({ id: 'clocktower', due: clockEnd, endTime: clockEnd });
    for (const event of events) { const key = `${account.tag}/${snapshot.timestamp}/${event.id}/${event.endTime}`; next.set(key, pendingNotifications.get(key) ?? { ...event, tag: account.tag, fired: false }); }
  }
  pendingNotifications = next;
}
async function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const [key, event] of pendingNotifications) {
    if (event.fired || event.due > Date.now()) continue;
    event.fired = true;
    const account = state.accounts.find(item => item.tag === event.tag);
    if (!account) continue;
    const message = event.endTime <= Date.now() ? t('升级已完成！', ' upgrade complete!') : t('即将升级完成！', ' upgrade is finishing!');
    const body = event.id === 'clocktower' ? t('时钟塔冷却结束，可以再次启动！', 'Clock Tower is ready!') : `${itemName(event.data, state.language)}${message}`;
    toast(`${displayName(account)} · ${body}`);
    try {
      const options = { body, tag: key, icon: './icon.svg' };
      if (registration) await registration.showNotification(displayName(account), options); else new Notification(displayName(account), options);
    } catch { /* The in-page message remains available. */ }
  }
}
async function handleAction(action, button) {
  switch (action) {
    case 'import': importDialog(); void scanClipboard({ interactive: true, allowedView: 'import' }); break;
    case 'auto-clipboard': toggleAutoClipboard(); break;
    case 'accounts': accountsDialog(); break;
    case 'account-menu': accountMenuDialog(); break;
    case 'settings': settingsDialog(); break;
    case 'close': $('#dialog').close(); break;
    case 'import-submit': submitImport(); break;
    case 'select': state.selected = button.dataset.tag; state.demo = false; state.village = 'home'; if ($('#dialog').open) $('#dialog').close(); render(); break;
    case 'village': state.village = button.dataset.value; render(); break;
    case 'filter': state.filter = button.dataset.value; render(); break;
    case 'demo': state.demo = true; state.village = 'home'; render(); break;
    case 'exit-demo': state.demo = false; if ($('#dialog').open) $('#dialog').close(); render(); break;
    case 'language': {
      const settingsOpen = $('#dialog').open && $('#dialog').dataset.view === 'settings';
      state.language = state.language === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('cocparse.language', state.language); } catch { /* Language still changes for this visit. */ }
      render();
      if (settingsOpen) settingsDialog();
      break;
    }
    case 'backup': if (state.accounts.length) download(`cocParse-backup-${new Date().toISOString().slice(0, 10)}.json`, makeBackup(state.accounts)); break;
    case 'about': aboutDialog(); break;
    case 'raw': rawDialog(); break;
    case 'rename': renameDialog(); break;
    case 'notify': await toggleNotify(); break;
    case 'rename-save': {
      const account = selectedAccount();
      if (account && persist(state.accounts.map(item => item.tag === account.tag ? { ...item, alias: $('#alias-input').value.trim() } : item))) { $('#dialog').close(); render(); toast(t('别名已保存。', 'Alias saved.')); }
      break;
    }
    case 'delete': {
      const account = selectedAccount();
      if (!account || state.demo) break;
      openDialog(t('删除这个账号？', 'Delete this account?'), `<p>${t('将从此浏览器移除', 'This will remove')} <strong>${esc(displayName(account))}</strong>${t(' 的记录。你可以先导出备份，之后再重新导入。', ' from this browser. Export a backup first if you want to restore it later.')}</p>`, `<button class="button secondary" data-action="close">${t('取消', 'Cancel')}</button><button class="button destructive" data-action="delete-confirm">${t('确认删除', 'Delete account')}</button>`); break;
    }
    case 'delete-confirm': {
      const next = state.accounts.filter(account => account.tag !== state.selected);
      if (persist(next)) { state.selected = next[0]?.tag ?? null; state.village = 'home'; $('#dialog').close(); render(); toast(t('账号已删除。', 'Account deleted.')); }
      break;
    }
    case 'clipboard':
      try { $('#import-text').value = await navigator.clipboard.readText(); $('#import-text').focus(); }
      catch { $('#import-error').textContent = t('无法读取剪贴板，请在输入框中手动粘贴（Ctrl/Cmd + V）。', 'Clipboard unavailable. Paste into the field with Ctrl/Cmd + V.'); $('#import-error').hidden = false; $('#import-text').focus(); }
      break;
    case 'copy-raw':
      try { await navigator.clipboard.writeText(JSON.stringify(snapshotOf(selectedAccount()), null, 2)); toast(t('JSON 已复制。', 'JSON copied.')); }
      catch { toast(t('复制失败，请选择原始 JSON 手动复制。', 'Copy failed. Select and copy the raw JSON manually.'), true); }
      break;
    case 'download-raw': { const account = selectedAccount(); download(`coc-${account.tag.replace(/[^a-zA-Z0-9]/g, '')}.json`, JSON.stringify(snapshotOf(account), null, 2)); break; }
    case 'recover': try { download('cocParse-recovery.json', localStorage.getItem(STORAGE_KEY) ?? ''); } catch { toast(t('无法访问浏览器存储。', 'Browser storage is unavailable.'), true); } break;
    case 'reset': openDialog(t('重置无法读取的存档？', 'Reset unreadable data?'), `<p>${t('请先下载原存档备份。重置会删除此网站的账号记录。', 'Download the original data first. Resetting removes this site’s account records.')}</p>`, `<button class="button secondary" data-action="close">${t('取消', 'Cancel')}</button><button class="button destructive" data-action="reset-confirm">${t('确认重置', 'Reset data')}</button>`); break;
    case 'reset-confirm': try { localStorage.removeItem(STORAGE_KEY); state.storageError = false; state.accounts = []; state.selected = null; $('#dialog').close(); render(); } catch { toast(t('无法重置：浏览器存储不可用。', 'Cannot reset: browser storage is unavailable.'), true); } break;
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  handleAction(button.dataset.action, button).catch(() => toast(t('操作未完成，请重试。', 'The action could not be completed. Try again.'), true));
});
document.addEventListener('input', event => {
  if (event.target.id === 'account-search') { state.search = event.target.value; $('#account-list').innerHTML = renderAccounts(); }
  if (event.target.id === 'sheet-account-search') $('#sheet-account-list').innerHTML = renderAccounts(event.target.value);
  if (event.target.id === 'import-text') $('#import-error').hidden = true;
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'alias-input' && event.key === 'Enter') { event.preventDefault(); handleAction('rename-save'); }
  if (event.target.id === 'import-text' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitImport(); }
});
async function readFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { $('#import-error').textContent = t(...errors.fileTooLarge); $('#import-error').hidden = false; return; }
  try { $('#import-text').value = await file.text(); $('#file-name').textContent = file.name; $('#import-error').hidden = true; }
  catch { $('#import-error').textContent = t('文件无法读取，请重试。', 'Could not read the file. Try again.'); $('#import-error').hidden = false; }
}
document.addEventListener('change', event => { if (event.target.id === 'import-file') readFile(event.target.files[0]); });
$('#dialog').addEventListener('dragover', event => { if ($('#dialog').open && $('#import-text')) event.preventDefault(); });
$('#dialog').addEventListener('drop', event => { if ($('#dialog').open && $('#import-text') && event.dataTransfer.files.length) { event.preventDefault(); readFile(event.dataTransfer.files[0]); } });
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) { const rect = $('#dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#dialog').close(); } });
window.addEventListener('storage', event => {
  if (event.key === 'cocparse.autoClipboard' || event.key === null) {
    try { autoClipboard = localStorage.getItem('cocparse.autoClipboard') !== 'false'; } catch { /* Keep this visit's setting. */ }
  }
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  try { state.accounts = loadAccounts(localStorage); state.storageError = false; if (!state.accounts.some(account => account.tag === state.selected)) state.selected = state.accounts[0]?.tag ?? null; rebuildNotifications(); render(); } catch { state.storageError = true; render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickCountdowns(); checkNotifications(); void scanClipboard(); } });
window.addEventListener('focus', () => { void scanClipboard(); });
render(); rebuildNotifications();
void scanClipboard();
setInterval(() => { if (currentSignature() !== completionSignature) render(); else tickCountdowns(); checkNotifications(); }, 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).then(worker => { registration = worker; }).catch(() => { /* Online use also works without offline support. */ });
