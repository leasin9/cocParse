import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOSTS, STORAGE_KEY, demoSnapshot, formatDuration, hallLevel, importAccounts, itemName, loadAccounts, makeBackup, parseImport, realDuration, saveAccounts, scanUpgrades, validateSnapshot } from '../public/core.js';

const timestamp = 1760000000;
const now = elapsed => (timestamp + elapsed) * 1000;
const snapshot = extra => ({ tag: '#ABC123', timestamp, ...extra });
const entries = value => parseImport(JSON.stringify(value));
const upgrade = (value, elapsed = 0, village = 'home') => scanUpgrades(snapshot(value), village, now(elapsed));

test('decodes both villages, snake case fields, and optional groups', () => {
  const value = validateSnapshot(snapshot({ buildings: [{ data: 1000001, lvl: 15, weapon: 3, gear_up: 1, helper_recurrent: true }], buildings2: [{ data: 1000034, lvl: 9 }], siege_machines: [{ data: 4000051, lvl: 2 }] }));
  assert.equal(hallLevel(value), 15);
  assert.equal(hallLevel(value, true), 9);
  assert.equal(value.buildings[0].gear_up, 1);
  assert.equal(value.siege_machines.length, 1);
  assert.equal(hallLevel(snapshot()), 0);
  assert.deepEqual(scanUpgrades(snapshot(), 'home', now(0)), []);
});

test('preserves unrecognized game fields when importing', () => {
  const result = importAccounts([], entries(snapshot({ future_feature: { value: 42 } })), now(0));
  assert.equal(JSON.parse(result.accounts[0].rawJSON).future_feature.value, 42);
});

test('normalizes tag casing and surrounding whitespace', () => {
  assert.equal(validateSnapshot({ tag: ' #abc123 ', timestamp }).tag, '#ABC123');
});

for (const [label, value, code] of [
  ['invalid JSON', '{', 'invalidJSON'],
  ['empty tag', JSON.stringify({ tag: ' ', timestamp }), 'invalidTag'],
  ['missing timestamp', JSON.stringify({ tag: '#X' }), 'invalidTimestamp'],
  ['string timestamp', JSON.stringify({ tag: '#X', timestamp: '1760000000' }), 'invalidTimestamp'],
  ['non-array group', JSON.stringify(snapshot({ buildings: {} })), 'invalidItems'],
  ['missing data id', JSON.stringify(snapshot({ buildings: [{ lvl: 3 }] })), 'invalidItems'],
  ['string timer', JSON.stringify(snapshot({ buildings: [{ data: 1000002, timer: '600' }] })), 'invalidItems'],
  ['unrepresentable completion date', JSON.stringify(snapshot({ buildings: [{ data: 1000002, timer: Number.MAX_SAFE_INTEGER }] })), 'invalidItems'],
  ['non-object boosts', JSON.stringify(snapshot({ boosts: [] })), 'invalidBoosts'],
  ['invalid boost duration', JSON.stringify(snapshot({ boosts: { builder_boost: '3600' } })), 'invalidBoosts'],
  ['empty array', '[]', 'invalidSnapshot'],
  ['unsupported backup', JSON.stringify({ format: 'coc-record-web', version: 2, accounts: [] }), 'invalidBackup'],
]) {
  test(`rejects ${label} with an actionable error`, () => {
    assert.throws(() => parseImport(value), error => error.code === code);
  });
}

test('accepts BOM-prefixed JSON files', () => assert.equal(parseImport('\uFEFF' + JSON.stringify(snapshot()))[0].snapshot.tag, '#ABC123'));
test('rejects oversized input', () => assert.throws(() => parseImport(' '.repeat(10 * 1024 * 1024 + 1)), error => error.code === 'fileTooLarge'));

test('creates and updates accounts by tag without changing their order or alias', () => {
  const first = importAccounts([], entries([snapshot(), { tag: '#SECOND', timestamp }]), now(0));
  first.accounts[0].alias = 'Main';
  const result = importAccounts(first.accounts, entries(snapshot({ timestamp: timestamp + 100, buildings: [{ data: 1000001, lvl: 16 }] })), now(100));
  assert.equal(result.accounts.length, 2);
  assert.equal(result.updated, 1);
  assert.equal(result.accounts[0].alias, 'Main');
  assert.equal(result.accounts[0].firstRecorded, now(0));
  assert.equal(result.accounts[0].updateCount, 2);
  assert.equal(hallLevel(JSON.parse(result.accounts[0].rawJSON)), 16);
  assert.equal(first.accounts[0].updateCount, 1, 'the original array is not mutated before saving');
});

test('stale data cannot overwrite a newer snapshot or increment its count', () => {
  const first = importAccounts([], entries(snapshot()), now(0));
  const result = importAccounts(first.accounts, entries(snapshot({ timestamp: timestamp - 100 })), now(100));
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.accounts, first.accounts);
});

test('equal timestamps can update corrected data', () => {
  const first = importAccounts([], entries(snapshot()), now(0));
  const result = importAccounts(first.accounts, entries(snapshot({ buildings: [{ data: 1000001, lvl: 15 }] })), now(10));
  assert.equal(result.updated, 1);
  assert.equal(result.accounts[0].updateCount, 2);
});

test('a batch containing invalid data is rejected before any account is changed', () => {
  const original = importAccounts([], entries(snapshot()), now(0)).accounts;
  const before = JSON.stringify(original);
  assert.throws(() => entries([snapshot({ timestamp: timestamp + 100 }), { tag: '#BROKEN' }]));
  assert.equal(JSON.stringify(original), before);
});

test('backup round trip retains accounts, aliases, notification preference and history', () => {
  const original = importAccounts([], entries([snapshot(), { tag: '#SECOND', timestamp }]), now(0)).accounts;
  original[0].alias = '主号'; original[0].notifyEnabled = true; original[0].updateCount = 12;
  const restored = importAccounts([], parseImport(makeBackup(original)), now(100)).accounts;
  for (const [index, account] of restored.entries()) {
    for (const field of ['tag', 'rawJSON', 'alias', 'notifyEnabled', 'firstRecorded', 'updateCount']) assert.equal(account[field], original[index][field]);
  }
});

test('loads saved records and propagates quota failures without losing prior records', () => {
  const accounts = importAccounts([], entries(snapshot()), now(0)).accounts;
  const storage = { value: null, getItem(key) { assert.equal(key, STORAGE_KEY); return this.value; }, setItem(key, value) { assert.equal(key, STORAGE_KEY); this.value = value; } };
  assert.deepEqual(loadAccounts(storage), []);
  saveAccounts(storage, accounts);
  assert.deepEqual(loadAccounts(storage), accounts);
  const before = storage.value;
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => saveAccounts(storage, []), /quota/);
  assert.equal(storage.value, before);
});

test('corrupt or duplicate local accounts are reported instead of silently discarded', () => {
  assert.throws(() => loadAccounts({ getItem: () => 'broken' }));
  const accounts = importAccounts([], entries(snapshot()), now(0)).accounts;
  assert.throws(() => loadAccounts({ getItem: () => JSON.stringify({ version: 1, accounts: [...accounts, ...accounts] }) }));
});

test('scans traps in both villages and skips items without timers', () => {
  assert.equal(upgrade({ traps: [{ data: 12000000, lvl: 5, timer: 600 }] }, 100)[0].remaining, 500);
  assert.equal(upgrade({ traps2: [{ data: 12000001, lvl: 2, timer: 600 }] }, 0, 'builder')[0].remaining, 600);
  assert.equal(upgrade({ buildings: [{ data: 1000001, lvl: 15 }, { data: 1000002, lvl: 3, timer: 100 }] }).length, 1);
});

test('duplicate buildings have unique ids stable across ticks and villages', () => {
  const value = { buildings: [{ data: 1000008, timer: 600 }, { data: 1000008, timer: 900 }] };
  const first = upgrade(value); const second = upgrade(value, 10);
  assert.equal(new Set(first.map(item => item.id)).size, 2);
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id));
});

test('sorts upgrades by real remaining time', () => {
  const result = upgrade({ buildings: [{ data: 1000002, timer: 900 }], heroes: [{ data: 28000006, timer: 300 }], traps: [{ data: 12000000, timer: 600 }] });
  assert.deepEqual(result.map(item => item.remaining), [300, 600, 900]);
});

test('builder potion fully covers an upgrade with 10× speed', () => {
  const result = upgrade({ buildings: [{ data: 1000002, timer: 18000 }], boosts: { builder_boost: 3600 } }, 600)[0];
  assert.equal(result.remaining, 1200); assert.equal(result.gameRemaining, 12000); assert.equal(result.isBoosted, true);
  assert.equal(result.endTime, now(1800));
});

test('the portion beyond the potion window runs at normal speed', () => {
  const value = { buildings: [{ data: 1000002, timer: 72000 }], boosts: { builder_boost: 3600 } };
  assert.equal(upgrade(value)[0].remaining, 39600);
  const expired = upgrade(value, 4000)[0];
  assert.equal(expired.remaining, 35600); assert.equal(expired.gameRemaining, 35600); assert.equal(expired.isBoosted, false);
});

test('research potion applies only to units, spells and siege machines', () => {
  const result = upgrade({ buildings: [{ data: 1000002, timer: 2400 }], units: [{ data: 4000000, timer: 2400 }], spells: [{ data: 26000000, timer: 2400 }], siege_machines: [{ data: 4000051, timer: 2400 }], boosts: { lab_boost: 3600 } });
  assert.deepEqual(result.map(item => item.remaining), [100, 100, 100, 2400]);
});

test('pet potion affects pets and equipment stays unboosted', () => {
  const result = upgrade({ pets: [{ data: 73000000, timer: 4800 }], equipment: [{ data: 90000000, timer: 4800 }], boosts: { pet_boost: 3600, builder_boost: 3600 } });
  assert.deepEqual(result.map(item => item.remaining), [200, 4800]);
});

test('clock tower boosts all builder base categories', () => {
  const result = upgrade({ buildings2: [{ data: 1000035, timer: 3000 }], traps2: [{ data: 12000001, timer: 3000 }], heroes2: [{ data: 28000003, timer: 3000 }], units2: [{ data: 4000031, timer: 3000 }], boosts: { clocktower_boost: 600 } }, 0, 'builder');
  assert.deepEqual(result.map(item => item.remaining), [300, 300, 300, 300]);
});

test('zero boost is inactive, completion is stable, and progress is clamped', () => {
  assert.equal(upgrade({ buildings: [{ data: 1000002, timer: 10 }], boosts: { builder_boost: 0 } })[0].remaining, 10);
  assert.equal(upgrade({ buildings: [{ data: 1000002, timer: 10 }] }, 20)[0].progress, 100);
  assert.equal(upgrade({ buildings: [{ data: 1000002, timer: 10 }] }, -10)[0].progress, 0);
  for (const effect of Object.values(BOOSTS)) assert.equal(realDuration(0, { remaining: 3600, multiplier: effect.multiplier }), 0);
});

test('clock tower cooldown is relative to the export timestamp', () => {
  const value = snapshot({ boosts: { clocktower_cooldown: 5000 } });
  assert.equal(value.timestamp + value.boosts.clocktower_cooldown - now(1200) / 1000, 3800);
});

test('names retain bilingual source data and unknown ids have a readable fallback', () => {
  assert.equal(itemName(28000006), '亡灵王子'); assert.equal(itemName(28000006, 'en'), 'Minion Prince');
  assert.equal(itemName(1000008), '加农炮'); assert.equal(itemName(1000008, 'en'), 'Cannon');
  assert.equal(itemName(1000999), '建筑 #1000999'); assert.equal(itemName(99000000, 'en'), 'Other #99000000');
});

test('duration formatting matches the source app in both languages', () => {
  for (const [input, zh, en] of [[0, '已完成', 'Done'], [-5, '已完成', 'Done'], [59, '59秒', '59s'], [59.2, '1分0秒', '1m 0s'], [3599, '59分59秒', '59m 59s'], [3600, '1小时', '1h'], [90060, '1天1小时1分', '1d 1h 1m']]) {
    assert.equal(formatDuration(input), zh); assert.equal(formatDuration(input, 'en'), en);
  }
});

test('demo is a valid export with upgrade data in both villages', () => {
  const demo = validateSnapshot(demoSnapshot(now(0)));
  assert.equal(hallLevel(demo), 16); assert.equal(hallLevel(demo, true), 10);
  assert.ok(scanUpgrades(demo, 'home', now(0)).length > 0); assert.ok(scanUpgrades(demo, 'builder', now(0)).length > 0);
});
