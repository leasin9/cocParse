import { namesEN, namesZH } from './names.js';

export const GROUPS = ['buildings', 'traps', 'heroes', 'units', 'spells', 'siege_machines', 'pets', 'equipment', 'buildings2', 'traps2', 'heroes2', 'units2'];
export const BOOSTS = {
  builder_boost: { multiplier: 10, groups: ['buildings', 'traps', 'heroes'] },
  lab_boost: { multiplier: 24, groups: ['units', 'spells', 'siege_machines'] },
  pet_boost: { multiplier: 24, groups: ['pets'] },
  clocktower_boost: { multiplier: 10, groups: ['buildings2', 'traps2', 'heroes2', 'units2'] },
};
export const STORAGE_KEY = 'cocparse.accounts.v1';

export class ImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** 校验游戏导出，保留未知字段以便重新导出。 */
export function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImportError('invalidSnapshot');
  if (typeof value.tag !== 'string' || !value.tag.trim() || value.tag.length > 100) throw new ImportError('invalidTag');
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp <= 0 || value.timestamp > 8_640_000_000_000) throw new ImportError('invalidTimestamp');
  for (const group of GROUPS) {
    if (value[group] == null) continue;
    if (!Array.isArray(value[group])) throw new ImportError('invalidItems');
    for (const item of value[group]) {
      if (!item || !Number.isSafeInteger(item.data) || item.data < 0) throw new ImportError('invalidItems');
      for (const key of ['lvl', 'cnt', 'timer', 'weapon', 'gear_up']) {
        if (item[key] != null && !Number.isSafeInteger(item[key])) throw new ImportError('invalidItems');
      }
      if (item.timer != null && !Number.isFinite(new Date((value.timestamp + item.timer) * 1000).getTime())) throw new ImportError('invalidItems');
    }
  }
  if (value.boosts != null) {
    if (typeof value.boosts !== 'object' || Array.isArray(value.boosts)) throw new ImportError('invalidBoosts');
    for (const key of [...Object.keys(BOOSTS), 'clocktower_cooldown']) {
      if (value.boosts[key] != null && !Number.isSafeInteger(value.boosts[key])) throw new ImportError('invalidBoosts');
    }
  }
  return { ...value, tag: value.tag.trim().toUpperCase() };
}

/** 同时支持单账号、账号数组和 Web 版完整备份。 */
export function parseImport(text) {
  if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new ImportError('fileTooLarge');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new ImportError('invalidJSON'); }
  if (value?.format === 'coc-record-web') {
    if (value.version !== 1 || !Array.isArray(value.accounts) || !value.accounts.length) throw new ImportError('invalidBackup');
    return value.accounts.map(record => {
      if (!record || typeof record.rawJSON !== 'string') throw new ImportError('invalidBackup');
      let raw;
      try { raw = JSON.parse(record.rawJSON); } catch { throw new ImportError('invalidBackup'); }
      const snapshot = validateSnapshot(raw);
      return { snapshot, metadata: { alias: typeof record.alias === 'string' ? record.alias.slice(0, 80) : '', notifyEnabled: record.notifyEnabled === true,
        firstRecorded: Number.isFinite(record.firstRecorded) ? record.firstRecorded : undefined,
        updateCount: Number.isSafeInteger(record.updateCount) && record.updateCount > 0 ? record.updateCount : 1 } };
    });
  }
  const snapshots = Array.isArray(value) ? value : [value];
  if (!snapshots.length) throw new ImportError('invalidSnapshot');
  return snapshots.map(item => ({ snapshot: validateSnapshot(item) }));
}

/** 以 tag 为唯一值更新账号，拒绝旧导出覆盖新数据。 */
export function importAccounts(accounts, entries, now = Date.now()) {
  const next = accounts.map(account => ({ ...account }));
  const result = { accounts: next, added: 0, updated: 0, skipped: 0, selectedTag: null };
  for (const { snapshot, metadata } of entries) {
    const index = next.findIndex(account => account.tag === snapshot.tag);
    const previous = next[index];
    result.selectedTag = snapshot.tag;
    if (previous && snapshot.timestamp < JSON.parse(previous.rawJSON).timestamp) { result.skipped++; continue; }
    const record = { tag: snapshot.tag, rawJSON: JSON.stringify(snapshot),
      alias: previous?.alias ?? metadata?.alias ?? '',
      notifyEnabled: previous?.notifyEnabled ?? metadata?.notifyEnabled ?? false,
      firstRecorded: previous?.firstRecorded ?? metadata?.firstRecorded ?? now,
      lastUpdated: now, updateCount: previous ? previous.updateCount + 1 : metadata?.updateCount ?? 1 };
    if (previous) { next[index] = record; result.updated++; } else { next.push(record); result.added++; }
  }
  return result;
}

export function makeBackup(accounts) {
  return JSON.stringify({ format: 'coc-record-web', version: 1, exportedAt: new Date().toISOString(), accounts }, null, 2);
}

/** 剪贴板只自动导入游戏导出，跳过备份、旧快照和重复内容。 */
export function importClipboard(accounts, text, now = Date.now()) {
  let entries;
  try { entries = parseImport(text); } catch { return null; }
  if (entries.some(entry => entry.metadata)) return null;
  const latest = new Map();
  for (const entry of entries) {
    const previous = latest.get(entry.snapshot.tag);
    if (!previous || entry.snapshot.timestamp >= previous.snapshot.timestamp) latest.set(entry.snapshot.tag, entry);
  }
  const canonical = snapshot => JSON.stringify(snapshot, (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]])) : value);
  const fresh = [...latest.values()].filter(({ snapshot }) => {
    const account = accounts.find(item => item.tag === snapshot.tag);
    if (!account) return true;
    const saved = JSON.parse(account.rawJSON);
    return snapshot.timestamp >= saved.timestamp && canonical(snapshot) !== canonical(saved);
  });
  return fresh.length ? importAccounts(accounts, fresh, now) : null;
}

/** 写入成功后再更新界面，避免配额或隐私模式导致静默丢失。 */
export function saveAccounts(storage, accounts) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, accounts }));
}

export function loadAccounts(storage) {
  const text = storage.getItem(STORAGE_KEY);
  if (!text) return [];
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.accounts)) throw new ImportError('invalidBackup');
  const tags = new Set();
  return data.accounts.map(record => {
    const snapshot = validateSnapshot(JSON.parse(record.rawJSON));
    if (tags.has(snapshot.tag)) throw new ImportError('invalidBackup');
    tags.add(snapshot.tag);
    return { tag: snapshot.tag, rawJSON: JSON.stringify(snapshot), alias: typeof record.alias === 'string' ? record.alias : '',
      notifyEnabled: record.notifyEnabled === true,
      firstRecorded: Number.isFinite(record.firstRecorded) ? record.firstRecorded : Date.now(),
      lastUpdated: Number.isFinite(record.lastUpdated) ? record.lastUpdated : Date.now(),
      updateCount: Number.isSafeInteger(record.updateCount) && record.updateCount > 0 ? record.updateCount : 1 };
  });
}

export function itemName(id, lang = 'zh') {
  if (lang === 'zh' && namesZH[id]) return namesZH[id];
  if (namesEN[id]) return namesEN[id];
  const category = ({ 1: ['建筑', 'Building'], 4: ['兵种', 'Troop'], 12: ['陷阱', 'Trap'], 18: ['装饰', 'Decoration'], 26: ['法术', 'Spell'], 28: ['英雄', 'Hero'], 73: ['宠物', 'Pet'], 90: ['装备', 'Equipment'] })[Math.floor(id / 1_000_000)];
  return `${category ? category[lang === 'zh' ? 0 : 1] : lang === 'zh' ? '其他' : 'Other'} #${id}`;
}

export function boostFor(snapshot, group) {
  for (const [key, effect] of Object.entries(BOOSTS)) {
    const remaining = snapshot.boosts?.[key] ?? 0;
    if (effect.groups.includes(group) && remaining > 0) return { remaining, multiplier: effect.multiplier };
  }
  return null;
}

export function realDuration(timer, boost) {
  if (!boost) return timer;
  return timer <= boost.remaining * boost.multiplier ? timer / boost.multiplier : boost.remaining + timer - boost.remaining * boost.multiplier;
}

export function gameElapsed(elapsed, boost) {
  if (!boost) return elapsed;
  return Math.min(elapsed, boost.remaining) * boost.multiplier + Math.max(0, elapsed - boost.remaining);
}

/** 按原 iOS 逻辑换算真实结束时间；同类建筑使用稳定且唯一的 id。 */
export function scanUpgrades(snapshot, village = 'home', now = Date.now()) {
  const elapsed = (now / 1000) - snapshot.timestamp;
  const groups = GROUPS.filter(group => village === 'builder' ? group.endsWith('2') : !group.endsWith('2'));
  const result = [];
  for (const group of groups) {
    const boost = boostFor(snapshot, group);
    (snapshot[group] ?? []).forEach((item, index) => {
      if (item.timer == null) return;
      const duration = realDuration(item.timer, boost);
      const remaining = duration - elapsed;
      const gameRemaining = item.timer - gameElapsed(elapsed, boost);
      result.push({ id: `${group}-${item.data}-${index}`, data: item.data, group, village, level: item.lvl ?? 0,
        remaining, gameRemaining, duration, endTime: (snapshot.timestamp + duration) * 1000,
        isBoosted: gameRemaining - remaining >= 1,
        progress: duration <= 0 ? 100 : Math.max(0, Math.min(100, elapsed / duration * 100)) });
    });
  }
  return result.sort((a, b) => a.remaining - b.remaining || a.id.localeCompare(b.id));
}

export function hallLevel(snapshot, builder = false) {
  return (snapshot[builder ? 'buildings2' : 'buildings'] ?? []).find(item => item.data === (builder ? 1000034 : 1000001))?.lvl ?? 0;
}

export function formatDuration(seconds, lang = 'zh') {
  if (seconds <= 0) return lang === 'zh' ? '已完成' : 'Done';
  const s = Math.ceil(seconds);
  const values = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
  const units = lang === 'zh' ? ['天', '小时', '分', '秒'] : ['d', 'h', 'm', 's'];
  return values.map((value, index) => (value > 0 && index < 3) || (index === 3 && s < 3600) ? `${value}${units[index]}` : '').filter(Boolean).join(lang === 'zh' ? '' : ' ');
}

export function demoSnapshot(now = Date.now()) {
  return { tag: '#DEMO', timestamp: Math.floor(now / 1000),
    buildings: [{ data: 1000001, lvl: 16, weapon: 3 }, { data: 1000008, lvl: 20, timer: 142000 }, { data: 1000077, lvl: 2, timer: 218400 }, { data: 1000067, lvl: 4, timer: 86400 }],
    traps: [{ data: 12000000, lvl: 10, timer: 43200 }],
    heroes: [{ data: 28000000, lvl: 85, timer: 288000 }, { data: 28000001, lvl: 90 }, { data: 28000002, lvl: 65 }, { data: 28000004, lvl: 40 }, { data: 28000006, lvl: 65 }],
    units: [{ data: 4000000, lvl: 11 }, { data: 4000008, lvl: 10, timer: 180000 }, { data: 4000110, lvl: 2 }],
    spells: [{ data: 26000002, lvl: 6 }, { data: 26000005, lvl: 7 }],
    pets: [{ data: 73000003, lvl: 10 }, { data: 73000010, lvl: 5, timer: 108000 }],
    equipment: [{ data: 90000010, lvl: 18 }, { data: 90000004, lvl: 18 }],
    siege_machines: [{ data: 4000051, lvl: 4 }],
    buildings2: [{ data: 1000034, lvl: 10 }, { data: 1000041, lvl: 9, timer: 28800 }],
    heroes2: [{ data: 28000003, lvl: 30 }], units2: [{ data: 4000031, lvl: 18, timer: 43200 }],
    boosts: { builder_boost: 1800, lab_boost: 2400, pet_boost: 1200, clocktower_boost: 600, clocktower_cooldown: 18000 } };
}
