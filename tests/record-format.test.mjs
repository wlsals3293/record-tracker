import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseAppData, parseRecordItem, serializeAppData } from '../src/models/record.ts';
import { parseBackup, serializeBackup, planMerge, suggestSessionChoices } from '../src/services/backup.ts';
import { exportRecords, importRecords } from '../src/services/transfer.ts';
import { calculateStatistics } from '../src/services/statistics.ts';

const day = '2026-10-07', time = Date.parse(day + 'T12:00:00.123+09:00');
const base = { id: 'record', timestamp: time, result: null, memo: '한글 😀\n메모' };
const data = (records, version = 3) => ({ version, sessionsByDate: { [day]: [{ name: '운동', records }, { records: [] }] } });
const backup = (content) => JSON.stringify({ format: 'record-tracker-backup', backupVersion: 1, createdAt: '2026-10-08T00:00:00.000Z', data: content });
const transfer = (records, prefix = 'RT2:', version = 2) => prefix + gzipSync(JSON.stringify({ version, records })).toString('base64url');

test('all outputs omit only null metrics and preserve zero, decimals, result and memo', async () => {
  const values = [
    { size: null, duration: null }, { size: 0, duration: 0 },
    { size: 1.25, duration: 0.5 }, { size: 5, duration: null }, { size: null, duration: 60 },
  ];
  const records = values.map((metrics, index) => Object.freeze({ ...base, id: String(index), timestamp: time + index * 1000, ...metrics }));
  Object.freeze(records);
  const original = data(records), before = JSON.stringify(original);
  const expected = [
    { ...base, id: '0', timestamp: time },
    { ...base, id: '1', timestamp: time + 1000, size: 0, duration: 0 },
    { ...base, id: '2', timestamp: time + 2000, size: 1.25, duration: 0.5 },
    { ...base, id: '3', timestamp: time + 3000, size: 5 },
    { ...base, id: '4', timestamp: time + 4000, duration: 60 },
  ];
  const stored = serializeAppData(original), savedBackup = serializeBackup(original);
  const shared = await exportRecords(records);
  assert.deepEqual(JSON.parse(stored), data(expected));
  assert.deepEqual(JSON.parse(savedBackup).data, data(expected));
  assert.ok(shared.startsWith('RT2:'));
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(shared.slice(4), 'base64url'))), { version: 2, records: expected });
  assert.deepEqual(parseAppData(JSON.parse(stored)), original);
  assert.deepEqual(parseBackup(savedBackup).data, original);
  assert.deepEqual(await importRecords(shared), records);
  assert.equal(JSON.stringify(original), before);
  assert.equal(calculateStatistics(parseAppData(JSON.parse(stored)).sessionsByDate[day][0].records).totalMb, 6.25);
  assert.equal(calculateStatistics(await importRecords(shared)).totalSeconds, 60.5);
});

test('v1/v2 storage and backups plus RT1 sharing preserve legacy values during migration', async () => {
  const legacy = [
    { ...base, dataMb: null, lengthSeconds: null },
    { ...base, id: 'zero', timestamp: time + 1000, dataMb: 0, lengthSeconds: 0 },
    { ...base, id: 'decimal', timestamp: time + 2000, dataMb: 1.25, lengthSeconds: 60.5 },
  ];
  const expected = [
    { ...base, size: null, duration: null },
    { ...base, id: 'zero', timestamp: time + 1000, size: 0, duration: 0 },
    { ...base, id: 'decimal', timestamp: time + 2000, size: 1.25, duration: 60.5 },
  ];
  for (const old of [{ version: 1, records: legacy }, data(legacy, 2)]) {
    const before = JSON.stringify(old);
    const loaded = parseAppData(old), restored = parseBackup(backup(old)).data;
    assert.equal(loaded.version, 3);
    assert.deepEqual(loaded.sessionsByDate[day][0].records, expected);
    assert.deepEqual(restored, loaded);
    const saved = serializeAppData(loaded);
    assert.equal(saved.includes('dataMb'), false);
    assert.equal(saved.includes('lengthSeconds'), false);
    assert.deepEqual(parseAppData(JSON.parse(saved)), loaded);
    assert.equal(JSON.stringify(old), before);
  }
  assert.deepEqual(await importRecords(transfer(legacy, 'RT1:', 1)), expected);
});

test('omitted and explicit null metrics normalize identically through every input path', async () => {
  for (const input of [base, { ...base, size: null }, { ...base, duration: null }, { ...base, size: null, duration: null }]) {
    const expected = { ...base, size: null, duration: null };
    assert.deepEqual(parseRecordItem(input), expected);
    assert.deepEqual(parseAppData(data([input])).sessionsByDate[day][0].records, [expected]);
    assert.deepEqual(parseBackup(backup(data([input]))).data.sessionsByDate[day][0].records, [expected]);
    assert.deepEqual(await importRecords(transfer([input])), [expected]);
  }
});

test('invalid metrics and conflicting old/new aliases fail atomically on every input path', async () => {
  const invalid = [
    ...['size', 'duration', 'dataMb', 'lengthSeconds'].flatMap((key) => [-1, '1', true, {}, []].map((value) => ({ [key]: value }))),
    { size: 0, dataMb: 1 }, { duration: 60, lengthSeconds: 1 },
    { size: null, dataMb: 0 }, { duration: null, lengthSeconds: 0 },
    { size: 5, dataMb: '5' }, { duration: 5, lengthSeconds: -1 },
  ];
  for (const metrics of invalid) {
    const records = [{ ...base, id: 'valid' }, { ...base, ...metrics }];
    assert.equal(parseRecordItem(records[1]), null, JSON.stringify(metrics));
    assert.equal(parseAppData(data(records)), null);
    assert.throws(() => parseBackup(backup(data(records))));
    await assert.rejects(() => importRecords(transfer(records)));
    await assert.rejects(() => importRecords(transfer(records, 'RT1:', 1)));
  }
  for (const key of ['size', 'duration', 'dataMb', 'lengthSeconds']) {
    for (const value of [undefined, NaN, Infinity, -Infinity]) {
      assert.equal(parseRecordItem({ ...base, [key]: value }), null);
    }
  }
  assert.deepEqual(parseRecordItem({ ...base, size: 0, dataMb: 0, duration: 5, lengthSeconds: 5 }), { ...base, size: 0, duration: 5 });
});

test('merge treats legacy null and omitted metrics identically while keeping zero distinct', () => {
  const current = parseAppData(data([{ ...base, dataMb: null, lengthSeconds: null }], 2));
  const incoming = parseBackup(backup(data([base]))).data;
  const identical = planMerge(current, incoming, suggestSessionChoices(current, incoming));
  assert.equal(identical.pending, 0);
  assert.equal(identical.counts.identical, 1);
  assert.equal(identical.changed, false);
  const zeros = parseBackup(backup(data([{ ...base, size: 0, duration: 0 }]))).data;
  const conflict = planMerge(current, zeros, suggestSessionChoices(current, zeros));
  assert.equal(conflict.pending, 1);
  assert.equal(conflict.sessions[0].reviews[0].conflict, true);
});

test('transfer prefixes and payload versions must agree', async () => {
  for (const [prefix, version] of [['RT1:', 2], ['RT2:', 1], ['RT2:', 3], ['RT3:', 2]]) {
    await assert.rejects(() => importRecords(transfer([base], prefix, version)));
  }
  assert.deepEqual(await importRecords('  ' + transfer([base]) + '\n'), [{ ...base, size: null, duration: null }]);
});
