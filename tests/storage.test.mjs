import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { loadData, saveData, removeData, STORAGE_KEY } from '../src/storage/local-storage.ts';

const data = {
  version: 2,
  sessionsByDate: {
    '2026-10-07': [{ name: '운동', records: [{
      id: 'kept', timestamp: Date.parse('2026-10-07T12:00:00.123+09:00'),
      result: 'success', dataMb: 10, lengthSeconds: 5, memo: '한글 😀\n메모',
    }] }, { records: [] }],
  },
};
let entries, originalStorage;
beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => { entries.set(key, String(value)); },
      removeItem: (key) => { entries.delete(key); },
    },
  });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
});

test('real storage module saves and reloads all records while leaving theme unchanged', () => {
  entries.set('rt-theme', 'dark');
  assert.equal(saveData(data), true);
  assert.deepEqual(JSON.parse(entries.get(STORAGE_KEY)), data);
  assert.deepEqual(loadData(), data);
  assert.equal(entries.get('rt-theme'), 'dark');
});

test('failed writes return false and preserve previously saved data', (t) => {
  saveData(data);
  const before = entries.get(STORAGE_KEY);
  t.mock.method(console, 'error', () => {});
  t.mock.method(localStorage, 'setItem', () => { throw new DOMException('Full', 'QuotaExceededError'); });
  assert.equal(saveData({ version: 2, sessionsByDate: {} }), false);
  assert.equal(entries.get(STORAGE_KEY), before);
  assert.deepEqual(loadData(), data);
});

test('missing, malformed and unsupported saved data load as an empty data set', () => {
  for (const raw of [undefined, '{broken', '{"version":99}', '{"version":2,"sessionsByDate":[]}']) {
    entries.clear();
    if (raw !== undefined) entries.set(STORAGE_KEY, raw);
    assert.deepEqual(loadData(), { version: 2, sessionsByDate: {} });
  }
});

test('unavailable storage is handled on load', (t) => {
  t.mock.method(localStorage, 'getItem', () => { throw new DOMException('Blocked', 'SecurityError'); });
  assert.deepEqual(loadData(), { version: 2, sessionsByDate: {} });
});

test('legacy stored records migrate without changing the original stored value on read', () => {
  const records = data.sessionsByDate['2026-10-07'][0].records;
  const raw = JSON.stringify({ version: 1, records });
  entries.set(STORAGE_KEY, raw);
  assert.deepEqual(loadData(), { version: 2, sessionsByDate: { '2026-10-07': [{ records }] } });
  assert.equal(entries.get(STORAGE_KEY), raw);
});

test('removal preserves theme and reports storage failures without discarding data', (t) => {
  saveData(data);
  entries.set('rt-theme', 'dark');
  t.mock.method(console, 'error', () => {});
  const remove = t.mock.method(localStorage, 'removeItem', () => { throw new Error('Blocked'); });
  assert.equal(removeData(), false);
  assert.deepEqual(loadData(), data);
  remove.mock.restore();
  assert.equal(removeData(), true);
  assert.equal(entries.has(STORAGE_KEY), false);
  assert.equal(entries.get('rt-theme'), 'dark');
});
