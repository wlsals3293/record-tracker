import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeAppData, resolveSessionNames } from '../src/models/record.ts';
import { serializeBackup, parseBackup, planMerge, suggestSessionChoices, sessionKey, summarizeData, backupFilename } from '../src/services/backup.ts';
import { exportRecords, importRecords } from '../src/services/transfer.ts';

const day = '2026-10-07', time = Date.parse(day + 'T12:00:00+09:00'), key = sessionKey(day, 0);
const record = (id = 'a', offset = 0, extra = {}) => ({ id, timestamp: time + offset, result: null, dataMb: null, lengthSeconds: null, ...extra });
const session = (records = [], name) => ({ ...(name === undefined ? {} : { name }), records });
const data = (...sessions) => ({ version: 2, sessionsByDate: { [day]: sessions } });
const merged = (current, incoming, choices = suggestSessionChoices(current, incoming)) => planMerge(current, incoming, choices);
function choose(current, incoming, choices, side, rowIndex = 0, reviewIndex = 0) {
  const row = merged(current, incoming, choices).sessions[rowIndex], review = row.reviews[reviewIndex];
  choices[row.key].records[review.index] = { ...choices[row.key].records[review.index], side, valueToken: review.valueToken };
  return merged(current, incoming, choices);
}
function match(current, incoming, choices, target, rowIndex = 0, reviewIndex = 0) {
  const row = merged(current, incoming, choices).sessions[rowIndex], review = row.reviews[reviewIndex];
  choices[row.key].records[review.index] = { target, matchToken: review.matchToken };
  return merged(current, incoming, choices);
}
function freeze(value) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; }

test('a backup with no dates round-trips and merging it leaves current data unchanged', () => {
  const empty = { version: 2, sessionsByDate: {} };
  assert.deepEqual(parseBackup(serializeBackup(empty, time)).data, empty);
  const current = data(session([record()]));
  const plan = merged(current, empty);
  assert.equal(plan.pending, 0);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.data, current);
  assert.deepEqual(merged(empty, current).data, current);
});

test('backup round trip preserves dates, order, empty sessions, Unicode and milliseconds without settings', () => {
  const original = data(session([record('z', 900, { memo: '한글 😀\n<script>text</script>' })], '세션 1'), session([], '세션 7'), session([], '운동'));
  original.sessionsByDate['2026-10-06'] = [session()];
  original.theme = 'dark'; original.selectedDate = day;
  const before = JSON.stringify(original), exported = JSON.parse(serializeBackup(freeze(original), time));
  assert.deepEqual(Object.keys(exported), ['format', 'backupVersion', 'createdAt', 'data']);
  assert.deepEqual(Object.keys(exported.data), ['version', 'sessionsByDate']);
  assert.equal(exported.data.sessionsByDate[day][0].name, undefined);
  assert.equal(exported.data.sessionsByDate[day][1].name, '세션 7');
  const restored = parseBackup(JSON.stringify(exported)).data;
  assert.equal(serializeAppData(restored), serializeAppData({ version: 2, sessionsByDate: original.sessionsByDate }));
  assert.equal(JSON.stringify(original), before);
  assert.equal(backupFilename(time), 'record-tracker-backup-2026-10-07_120000.json');
});

test('validates external envelope, versions, calendar dates, timestamps and every record', () => {
  const fixture = () => JSON.parse(serializeBackup(data(session([record()])), time));
  const mutations = [
    (v) => { v.format = 'something-else'; }, (v) => { v.backupVersion = 2; },
    (v) => { v.createdAt = '2026-02-30T00:00:00.000Z'; }, (v) => { v.createdAt = 'tomorrow'; },
    (v) => { v.data.version = 3; }, (v) => { v.data.sessionsByDate = []; },
    (v) => { v.data.sessionsByDate['2026-02-30'] = []; },
    (v) => { v.data.sessionsByDate['0000-01-01'] = []; },
    (v) => { v.data.sessionsByDate[day][0].records[0].timestamp = 1e100; },
    (v) => { v.data.sessionsByDate[day][0].records.push(record('bad', 0, { dataMb: -1 })); },
    (v) => { v.data.sessionsByDate[day][0].name = ' '; },
    (v) => { v.data.sessionsByDate[day][0].records[0].memo = 1; },
    (v) => { v.data.sessionsByDate[day][0].records[0].id = ''; },
    (v) => { v.data.sessionsByDate[day][0].records[0].result = 'unknown'; },
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); assert.throws(() => parseBackup(JSON.stringify(value))); }
  assert.throws(() => parseBackup('RT1:anything'));
  assert.throws(() => parseBackup('{broken'));
  const poisoned = fixture();
  poisoned.data.sessionsByDate = JSON.parse('{"__proto__":[]}');
  assert.throws(() => parseBackup(JSON.stringify(poisoned)));
  assert.equal({}.polluted, undefined);
  const unknown = fixture();
  unknown.settings = { theme: 'dark' }; unknown.data.settings = { theme: 'dark' };
  unknown.data.sessionsByDate[day][0].other = 'ignored';
  unknown.data.sessionsByDate[day][0].records[0].other = 'ignored';
  assert.deepEqual(parseBackup(JSON.stringify(unknown)).data, data(session([record()])));
  assert.equal(parseBackup('\ufeff' + serializeBackup(data(session()), time)).data.version, 2);
});

test('v1 migration and empty day repair are explicit and duplicate names survive', () => {
  const envelope = JSON.parse(serializeBackup(data(session()), time));
  envelope.data = { version: 1, records: [record(), record('b', 86400000)] };
  const migrated = parseBackup(JSON.stringify(envelope));
  assert.equal(summarizeData(migrated.data).dates, 2);
  assert.equal(migrated.warnings.length, 1);
  const original = data(session([], '중복'), session([], '중복'));
  original.sessionsByDate['2026-10-08'] = [];
  const parsed = parseBackup(serializeBackup(original, time));
  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.data.sessionsByDate['2026-10-08'].length, 1);
  assert.equal(parsed.data.sessionsByDate[day].length, 2);
});

test('unique date/name sessions and identical records need no individual confirmation', () => {
  const current = freeze(data(session([record()], '운동'), session([], '빈 세션')));
  const incoming = freeze(parseBackup(serializeBackup(current, time)).data);
  const plan = merged(current, incoming);
  assert.equal(plan.pending, 0); assert.equal(plan.changed, false);
  assert.equal(plan.counts.identical, 1);
  assert.deepEqual(plan.sessions.map((row) => row.target), [0, 1]);
  assert.deepEqual(plan.data, current);
});

test('session mapping is date scoped, ambiguous names require selection, one-to-one is enforced', () => {
  const current = data(session([], '운동'), session([], '운동'));
  const incoming = data(session([], '운동'), session([], '다름'));
  const choices = suggestSessionChoices(current, incoming);
  assert.equal(choices[key].target, null);
  assert.equal(choices[sessionKey(day, 1)].target, 'new');
  assert.equal(merged(current, incoming, choices).pending, 1);
  choices[key].target = 0; choices[sessionKey(day, 1)].target = 0;
  assert.equal(merged(current, incoming, choices).pending, 2);
  choices[sessionKey(day, 1)].target = 1;
  assert.equal(merged(current, incoming, choices).pending, 0);
  assert.deepEqual(resolveSessionNames(merged(current, incoming, choices).data.sessionsByDate[day]), ['운동', '운동']);
  const duplicateSources = suggestSessionChoices(data(session([], '운동')), data(session([], '운동'), session([], '운동')));
  assert.equal(duplicateSources[key].target, null);
  const otherDate = { version: 2, sessionsByDate: { '2026-10-08': [session([], '운동')] } };
  assert.equal(Object.values(suggestSessionChoices(current, otherDate))[0].target, 'new');
});

test('new sessions keep order, records, explicit names and automatic names without renaming current sessions', () => {
  const current = data(session([record('old')]), session([], '세션 4'));
  const incoming = data(session([record('new')]), session([], '새 이름'));
  const choices = suggestSessionChoices(current, incoming);
  choices[key].target = 'new';
  const plan = merged(current, incoming, choices);
  assert.equal(plan.pending, 0);
  assert.deepEqual(resolveSessionNames(plan.data.sessionsByDate[day]), ['세션 1', '세션 4', '세션 3', '새 이름']);
  assert.equal(plan.data.sessionsByDate[day][2].name, undefined);
  const explicit = data(session([], '세션 1'));
  const explicitChoices = suggestSessionChoices(current, explicit);
  explicitChoices[key].target = 'new';
  assert.ok(merged(current, explicit, explicitChoices).pending > 0);
  explicitChoices[key].name = '이름 수정';
  assert.equal(merged(current, explicit, explicitChoices).pending, 0);
});

test('same second ignores IDs and milliseconds, but crossing a second creates a separate record', () => {
  const current = data(session([record('a', 100)]));
  const incoming = data(session([record('other', 900)]));
  const plan = merged(current, incoming);
  assert.equal(plan.counts.identical, 1); assert.equal(plan.changed, false);
  assert.deepEqual(plan.data.sessionsByDate[day][0].records, current.sessionsByDate[day][0].records);
  const boundary = merged(data(session([record('a', 999)])), data(session([record('b', 1000)])));
  assert.equal(boundary.counts.addedRecords, 1);
  assert.equal(boundary.data.sessionsByDate[day][0].records.length, 2);
});

test('content conflicts start unselected and choosing backup preserves current ID/position and backup milliseconds', () => {
  const current = freeze(data(session([record('a', 100), record('later', 2000)])));
  const incoming = freeze(data(session([record('b', 900, { result: 'success', memo: '백업 내용', dataMb: 3, lengthSeconds: 5 })])));
  const choices = suggestSessionChoices(current, incoming);
  assert.equal(merged(current, incoming, choices).pending, 1);
  const keep = choose(current, incoming, choices, 'current');
  assert.equal(keep.pending, 0); assert.equal(keep.changed, false); assert.equal(keep.counts.kept, 1);
  const applied = choose(current, incoming, choices, 'backup');
  assert.equal(applied.pending, 0); assert.equal(applied.counts.updated, 1);
  assert.deepEqual(applied.data.sessionsByDate[day][0].records[0], { ...incoming.sessionsByDate[day][0].records[0], id: 'a' });
  assert.equal(applied.data.sessionsByDate[day][0].records[1].id, 'later');
  assert.equal(current.sessionsByDate[day][0].records[0].dataMb, null);
});

test('same ID with changed time is a conflict; different ID/time is new; other sessions remain untouched', () => {
  const current = data(session([record()]), session([record()], '별도'));
  const incoming = data(session([record('a', 1000), record('b', 2000)]), session([record()], '별도'));
  const choices = suggestSessionChoices(current, incoming), initial = merged(current, incoming, choices);
  assert.equal(initial.pending, 1); assert.equal(initial.counts.addedRecords, 1); assert.equal(initial.counts.identical, 1);
  const applied = choose(current, incoming, choices, 'backup');
  assert.equal(applied.data.sessionsByDate[day][0].records.length, 2);
  assert.deepEqual(applied.data.sessionsByDate[day][1], current.sessionsByDate[day][1]);
});

test('ID/time disagreement and multiple same-second records require explicit correspondence without deleting any record', () => {
  const current = data(session([record('a'), record('b', 1000)]));
  const incoming = data(session([record('a', 1000, { dataMb: 7 })]));
  const choices = suggestSessionChoices(current, incoming);
  let plan = merged(current, incoming, choices);
  assert.equal(plan.pending, 1); assert.equal(plan.sessions[0].reviews[0].target, undefined);
  plan = match(current, incoming, choices, 0);
  assert.equal(plan.sessions[0].reviews[0].conflict, true);
  plan = choose(current, incoming, choices, 'backup');
  assert.ok(plan.sessions[0].reviews[0].collision); assert.ok(plan.pending > 0);
  plan = match(current, incoming, choices, 1);
  plan = choose(current, incoming, choices, 'backup');
  assert.equal(plan.pending, 0); assert.equal(plan.data.sessionsByDate[day][0].records.length, 2);
  assert.deepEqual(plan.data.sessionsByDate[day][0].records.map((r) => r.id), ['a', 'b']);
  const duplicates = data(session([record('a', 100), record('b', 900)]));
  const other = data(session([record('c', 500)])), duplicateChoices = suggestSessionChoices(duplicates, other);
  assert.equal(merged(duplicates, other, duplicateChoices).pending, 1);
  const chosen = match(duplicates, other, duplicateChoices, 1);
  assert.equal(chosen.pending, 0); assert.equal(chosen.counts.identical, 1);
  assert.equal(chosen.data.sessionsByDate[day][0].records.length, 2);
});

test('changing correspondence cannot reuse a content choice for another target', () => {
  const current = data(session([record('a'), record('b', 500, { dataMb: 2 })]));
  const incoming = data(session([record('c', 100, { dataMb: 3 })]));
  const choices = suggestSessionChoices(current, incoming);
  match(current, incoming, choices, 0);
  choose(current, incoming, choices, 'backup');
  // Even a caller accidentally retaining side/valueToken cannot reuse a decision.
  choices[key].records[0].target = 1;
  assert.equal(merged(current, incoming, choices).sessions[0].reviews[0].side, undefined);
});

test('repeat merge skips previously appended records and preserves original order', () => {
  const current = data(session([record('old', 3000)]));
  const incoming = data(session([record('new-b', 2000), record('new-a', 1000)]));
  const first = merged(current, incoming);
  assert.deepEqual(first.data.sessionsByDate[day][0].records.map((r) => r.id), ['old', 'new-b', 'new-a']);
  const again = merged(first.data, incoming);
  assert.equal(again.changed, false); assert.equal(again.counts.identical, 2);
});

for (const size of [500, 1000]) test('merge ' + size + ' records per session across multiple dates preserves every decision', () => {
  const current = { version: 2, sessionsByDate: {} }, incoming = { version: 2, sessionsByDate: {} };
  for (const date of ['2026-10-06', day, '2026-10-08']) {
    const start = Date.parse(date + 'T00:00:00+09:00');
    current.sessionsByDate[date] = Array.from({ length: 10 }, (_, s) => session(Array.from({ length: size }, (_, i) => record(s + '-' + i, 0, { timestamp: start + i * 1000, dataMb: i, memo: '기록 😀' }))));
    incoming.sessionsByDate[date] = current.sessionsByDate[date].map((s) => session(s.records.map((r, i) => ({ ...r, id: 'backup-' + r.id, timestamp: r.timestamp + 999, dataMb: i % 10 === 0 ? i + 1 : i }))));
  }
  const original = serializeAppData(current), choices = suggestSessionChoices(current, incoming);
  let plan = merged(current, incoming, choices);
  assert.equal(plan.pending, 30 * size / 10);
  assert.equal(plan.counts.identical, 30 * size * .9);
  for (const row of plan.sessions) for (const review of row.reviews) choices[row.key].records[review.index] = { side: 'backup', valueToken: review.valueToken };
  plan = merged(current, incoming, choices);
  assert.equal(plan.pending, 0); assert.equal(plan.counts.updated, 30 * size / 10);
  assert.equal(summarizeData(plan.data).records, 30 * size);
  assert.equal(serializeAppData(current), original);
  for (const [date, sessions] of Object.entries(current.sessionsByDate)) {
    sessions.forEach((session, sessionIndex) => {
      const expected = session.records.map((record, index) => index % 10 === 0
        ? { ...incoming.sessionsByDate[date][sessionIndex].records[index], id: record.id }
        : record);
      assert.deepEqual(plan.data.sessionsByDate[date][sessionIndex].records, expected);
    });
  }
  assert.equal(merged(plan.data, incoming).changed, false);
});

test('RT1 sharing still round-trips record payloads independently from backup format', async () => {
  const records = [record('x', 123, { memo: '공유 😀\n메모', dataMb: 10, result: 'success' })];
  const text = await exportRecords(records);
  assert.ok(text.startsWith('RT1:')); assert.deepEqual(await importRecords(text), records);
  assert.throws(() => parseBackup(text));
});

test('subsequent backup records use the selected new time without creating another duplicate', () => {
  const current = data(session([record('a')]));
  const incoming = data(session([record('a', 1000, { dataMb: 1 }), record('b', 1500, { dataMb: 1 })]));
  const choices = suggestSessionChoices(current, incoming);
  const plan = choose(current, incoming, choices, 'backup');
  assert.equal(plan.pending, 0);
  assert.equal(plan.data.sessionsByDate[day][0].records.length, 1);
  assert.equal(plan.counts.identical, 1);
  assert.equal(plan.data.sessionsByDate[day][0].records[0].id, 'a');
});

test('repeated backup IDs retain correspondence after an ID-different time match', () => {
  const current = data(session([record('a')]));
  const incoming = data(session([record('b'), record('b', 1000, { dataMb: 9 })]));
  const choices = suggestSessionChoices(current, incoming);
  let plan = merged(current, incoming, choices);
  assert.equal(plan.counts.addedRecords, 0);
  assert.equal(plan.pending, 1);
  plan = choose(current, incoming, choices, 'backup');
  assert.equal(plan.pending, 0);
  assert.equal(plan.data.sessionsByDate[day][0].records.length, 1);
  assert.deepEqual(plan.data.sessionsByDate[day][0].records[0], record('a', 1000, { dataMb: 9 }));
});

test('sequential conflict choices preserve final raw timestamp and count the stored update', () => {
  const current = data(session([record('a')]));
  const incoming = data(session([record('a', 900, { dataMb: 9 }), record('a', 500)]));
  const choices = suggestSessionChoices(current, incoming);
  choose(current, incoming, choices, 'backup', 0, 0);
  const plan = choose(current, incoming, choices, 'backup', 0, 1);
  assert.equal(plan.pending, 0);
  assert.equal(plan.changed, true); assert.equal(plan.counts.updated, 1);
  assert.equal(plan.data.sessionsByDate[day][0].records[0].timestamp, time + 500);
});
