import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionNames, serializeAppData, parseAppData } from '../src/models/record.ts';

const unnamed = () => ({ records: [] });
const named = (name) => ({ name, records: [] });
const asData = (sessions) => ({ version: 3, sessionsByDate: { '2026-10-07': sessions } });

test('automatic names avoid explicit names before and after their positions', () => {
  assert.deepEqual(resolveSessionNames([named('세션 2'), unnamed(), unnamed()]), ['세션 2', '세션 3', '세션 4']);
  assert.deepEqual(resolveSessionNames([unnamed(), named('세션 1')]), ['세션 2', '세션 1']);
  assert.deepEqual(resolveSessionNames([named(' 세션 2 '), unnamed()]), [' 세션 2 ', '세션 3']);
});

test('resolving names never reads or copies record arrays', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    ...(index === 0 ? { name: '세션 2' } : {}),
    get records() { throw new Error('Name resolution must not access records'); },
  }));
  assert.deepEqual(resolveSessionNames(sessions), Array.from({ length: 10 }, (_, index) => `세션 ${index + 2}`));
  assert.deepEqual(resolveSessionNames(sessions, 0), Array.from({ length: 10 }, (_, index) => `세션 ${index + 1}`));
});

test('ten sessions with one thousand records each retain every record after naming and storage', () => {
  const sessions = Array.from({ length: 10 }, (_, sessionIndex) => ({
    ...(sessionIndex === 0 ? { name: '세션 2' } : {}),
    records: Array.from({ length: 1000 }, (_, index) => ({
      id: `${sessionIndex}-${index}`,
      timestamp: Date.parse('2026-10-07T09:00:00+09:00') + index * 1000,
      result: index % 2 === 0 ? 'success' : null,
      size: index,
      duration: index * 2,
      memo: `세션 ${sessionIndex} 기록 ${index}`,
    })),
  }));
  const arrays = sessions.map((session) => session.records);
  const names = resolveSessionNames(sessions);
  sessions.forEach((session, index) => assert.equal(session.records, arrays[index]));
  const parsed = parseAppData(JSON.parse(serializeAppData(asData(sessions))));
  assert.deepEqual(parsed.sessionsByDate['2026-10-07'], sessions);
  assert.deepEqual(resolveSessionNames(parsed.sessionsByDate['2026-10-07']), names);
});

test('deleting a middle session recalculates automatic names without duplicates', () => {
  const sessions = [named('세션 2'), named('운동'), unnamed()];
  assert.deepEqual(resolveSessionNames(sessions), ['세션 2', '운동', '세션 3']);
  sessions.splice(1, 1);
  assert.deepEqual(resolveSessionNames(sessions), ['세션 2', '세션 3']);
  assert.equal(Object.hasOwn(sessions[1], 'name'), false);

  const ordinary = [unnamed(), unnamed(), unnamed()];
  ordinary.splice(1, 1);
  assert.deepEqual(resolveSessionNames(ordinary), ['세션 1', '세션 2']);
});

test('generated collision names stay omitted and stable across storage round trips', () => {
  const record = Object.freeze({ id: 'kept', timestamp: 1791349200000, result: null, size: 10, duration: 5, memo: '보존' });
  const sessions = Object.freeze([
    Object.freeze(named('세션 2')),
    Object.freeze({ records: Object.freeze([record]) }),
    Object.freeze(named('세션 7')),
  ]);
  const original = JSON.stringify(sessions);
  const parsed = parseAppData(JSON.parse(serializeAppData(asData(sessions))));
  assert.deepEqual(resolveSessionNames(parsed.sessionsByDate['2026-10-07']), ['세션 2', '세션 3', '세션 7']);
  assert.equal(Object.hasOwn(parsed.sessionsByDate['2026-10-07'][1], 'name'), false);
  assert.deepEqual(parsed.sessionsByDate['2026-10-07'][1].records, [record]);
  assert.equal(JSON.stringify(sessions), original);
});

test('legacy positional names normalize consistently without changing explicit exceptions', () => {
  const sessions = [named('세션 2'), unnamed(), named('세션 3'), named('세션 8')];
  const parsed = parseAppData(asData(sessions));
  assert.deepEqual(resolveSessionNames(sessions), resolveSessionNames(parsed.sessionsByDate['2026-10-07']));
  assert.equal(Object.hasOwn(parsed.sessionsByDate['2026-10-07'][2], 'name'), false);
  assert.equal(parsed.sessionsByDate['2026-10-07'][3].name, '세션 8');
});

test('legacy duplicate explicit names are preserved while automatic names avoid them', () => {
  const sessions = [named('세션 3'), named('세션 3'), unnamed()];
  assert.deepEqual(resolveSessionNames(sessions), ['세션 3', '세션 3', '세션 4']);
  assert.ok(parseAppData(asData(sessions)));
});

test('name resolution is deterministic and storage-safe across small session combinations', () => {
  const options = [undefined, '운동', '세션 1', '세션 2', '세션 3', '세션 4'];
  for (let value = 0; value < options.length ** 4; value++) {
    let remaining = value;
    const sessions = Array.from({ length: 4 }, () => {
      const name = options[remaining % options.length];
      remaining = Math.floor(remaining / options.length);
      return name === undefined ? unnamed() : named(name);
    });
    const names = resolveSessionNames(sessions);
    const explicitNames = sessions.flatMap((session, index) =>
      session.name === undefined || session.name === `세션 ${index + 1}` ? [] : [session.name],
    );
    if (new Set(explicitNames).size === explicitNames.length) {
      assert.equal(new Set(names).size, names.length, JSON.stringify(sessions));
    }
    const parsed = parseAppData(JSON.parse(serializeAppData(asData(sessions))));
    assert.deepEqual(resolveSessionNames(parsed.sessionsByDate['2026-10-07']), names);
  }
});
