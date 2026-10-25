import { APP_DATA_VERSION, parseRecordItem, parseAppData, resolveSessionNames, serializeAppData, type AppData, type RecordItem, type Session } from "../models/record";
import { kstDate, kstTime } from "./date";

export type RestoreMode = "replace" | "merge";
export type ConflictSide = "current" | "backup";
export interface BackupFile { createdAt: string; data: AppData; warnings: string[] }
export interface DataSummary { dates: number; sessions: number; records: number; firstDate?: string; lastDate?: string }
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function checkedRecord(value: unknown, location: string): RecordItem {
  const record = parseRecordItem(value);
  if (record === null) throw new Error(location + ": 기록의 ID·시각·결과·숫자·메모 형식이 올바르지 않습니다.");
  if (!Number.isFinite(new Date(record.timestamp).getTime()) || !isCalendarDate(kstDate(record.timestamp))) {
    throw new Error(location + ": 표시할 수 없는 기록 시각입니다.");
  }
  return record;
}

export function serializeBackup(data: AppData, now = Date.now()): string {
  const metadata = JSON.stringify({ format: "record-tracker-backup", backupVersion: 1, createdAt: new Date(now).toISOString() });
  return metadata.slice(0, -1) + ',"data":' + serializeAppData({ version: APP_DATA_VERSION, sessionsByDate: data.sessionsByDate }) + "}";
}
export function backupFilename(now = Date.now()): string {
  return "record-tracker-backup-" + kstDate(now) + "_" + kstTime(now).replaceAll(":", "") + ".json";
}
export function summarizeData(data: AppData): DataSummary {
  const dates = Object.keys(data.sessionsByDate).sort();
  let sessions = 0, records = 0;
  for (const day of Object.values(data.sessionsByDate)) {
    sessions += day.length;
    for (const session of day) records += session.records.length;
  }
  return { dates: dates.length, sessions, records, firstDate: dates[0], lastDate: dates.at(-1) };
}

export function parseBackup(text: string): BackupFile {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new Error("JSON 파일을 읽을 수 없습니다. 손상되지 않은 전체 백업 파일을 선택해 주세요."); }
  if (!isObject(value) || value.format !== "record-tracker-backup") throw new Error("이 앱의 전체 백업 파일이 아닙니다. 공유 문자열은 기록 가져오기를 이용해 주세요.");
  if (value.backupVersion !== 1) throw new Error("지원하지 않는 백업 규격 버전입니다.");
  if (typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value.createdAt)) {
    throw new Error("백업 생성 시각이 올바른 UTC ISO 형식이 아닙니다.");
  }
  const createdTimestamp = Date.parse(value.createdAt);
  const normalizedCreated = value.createdAt.includes(".") ? value.createdAt : value.createdAt.replace("Z", ".000Z");
  if (!Number.isFinite(createdTimestamp) || new Date(createdTimestamp).toISOString() !== normalizedCreated) {
    throw new Error("백업 생성 시각이 유효하지 않습니다.");
  }
  if (!isObject(value.data) || (value.data.version !== 1 && value.data.version !== 2 && value.data.version !== APP_DATA_VERSION)) {
    throw new Error("지원하지 않는 앱 데이터 버전입니다.");
  }
  const warnings: string[] = [];
  let sanitized: unknown;
  if (value.data.version === 1) {
    if (!Array.isArray(value.data.records)) throw new Error("이전 버전의 기록 목록이 올바르지 않습니다.");
    sanitized = { version: 1, records: value.data.records.map((item, index) => checkedRecord(item, (index + 1) + "번째 기록")) };
    warnings.push("이전 버전의 기록을 날짜별 첫 세션으로 변환했습니다.");
  } else {
    if (!isObject(value.data.sessionsByDate)) throw new Error("날짜별 세션 목록이 올바르지 않습니다.");
    const days: [string, Session[]][] = [];
    for (const [date, sessions] of Object.entries(value.data.sessionsByDate)) {
      if (!isCalendarDate(date)) throw new Error("유효하지 않은 날짜 키입니다: " + date);
      if (!Array.isArray(sessions)) throw new Error(date + ": 세션 목록은 배열이어야 합니다.");
      if (sessions.length === 0) warnings.push(date + ": 비어 있는 세션 배열을 빈 기본 세션 하나로 복구했습니다.");
      days.push([date, sessions.map((session: unknown, index) => {
        const location = date + " / " + (index + 1) + "번째 세션";
        if (!isObject(session) || !Array.isArray(session.records) ||
          (session.name !== undefined && (typeof session.name !== "string" || session.name.trim() === ""))) {
          throw new Error(location + ": 세션 이름 또는 기록 목록이 올바르지 않습니다.");
        }
        return { ...(typeof session.name === "string" ? { name: session.name } : {}),
          records: session.records.map((record, recordIndex) => checkedRecord(record, location + " / " + (recordIndex + 1) + "번째 기록")) };
      })]);
    }
    sanitized = { version: APP_DATA_VERSION, sessionsByDate: Object.fromEntries(days) };
  }
  const data = parseAppData(sanitized);
  if (data === null) throw new Error("앱 데이터 구조를 확인할 수 없습니다.");
  for (const [date, sessions] of Object.entries(data.sessionsByDate)) {
    const names = resolveSessionNames(sessions).map((name) => name.trim());
    if (new Set(names).size !== names.length) warnings.push(date + ": 같은 이름의 세션이 있습니다. 전체 교체에서는 각각 그대로 보존합니다.");
  }
  return { createdAt: value.createdAt, data, warnings };
}

export interface RecordChoice { target?: number; matchToken?: string; side?: ConflictSide; valueToken?: string }
export interface SessionChoice { target: number | "new" | null; name?: string; records: Record<string, RecordChoice> }
export type MergeChoices = Record<string, SessionChoice>;
export const sessionKey = (date: string, index: number): string => date + "/" + index;

export function suggestSessionChoices(current: AppData, incoming: AppData): MergeChoices {
  const choices: MergeChoices = {};
  for (const [date, sessions] of Object.entries(incoming.sessionsByDate)) {
    const currentNames = resolveSessionNames(current.sessionsByDate[date] ?? []).map((name) => name.trim());
    const sourceNames = resolveSessionNames(sessions).map((name) => name.trim());
    sessions.forEach((_, index) => {
      const name = sourceNames[index];
      const matches = currentNames.flatMap((candidate, target) => candidate === name ? [target] : []);
      const duplicate = sourceNames.filter((candidate) => candidate === name).length > 1 || matches.length > 1;
      choices[sessionKey(date, index)] = { target: duplicate ? null : matches[0] ?? "new", records: {} };
    });
  }
  return choices;
}

export interface MergeCounts { addedDates: number; addedSessions: number; addedRecords: number; identical: number; kept: number; updated: number }
export interface RecordReview {
  index: number; incoming: RecordItem; candidates: { index: number; record: RecordItem }[];
  ambiguous: boolean; matchToken: string; target?: number; current?: RecordItem;
  conflict: boolean; valueToken?: string; side?: ConflictSide; collision?: string;
}
export interface MergeSession {
  key: string; date: string; index: number; sourceName: string; source: Session;
  target: number | "new" | null; resultName?: string; resultIndex?: number;
  reviews: RecordReview[]; issues: string[];
}
export interface MergePlan { data: AppData; sessions: MergeSession[]; counts: MergeCounts; pending: number; changed: boolean }

const second = (record: RecordItem): number => Math.floor(record.timestamp / 1000);
function contentToken(record: RecordItem): string {
  return JSON.stringify([second(record), record.result, record.size, record.duration, record.memo ?? ""]);
}
export function sameRecordContent(left: RecordItem, right: RecordItem): boolean {
  return contentToken(left) === contentToken(right);
}
function indexRecords(records: RecordItem[]) {
  const ids = new Map<string, number[]>(), times = new Map<number, number[]>();
  function addTime(record: RecordItem, index: number) {
    const byTime = times.get(second(record)) ?? [];
    if (!byTime.includes(index)) byTime.push(index);
    times.set(second(record), byTime);
  }
  function addId(id: string, index: number) {
    const byId = ids.get(id) ?? [];
    if (!byId.includes(index)) byId.push(index);
    ids.set(id, byId);
  }
  function add(record: RecordItem, index: number) {
    addId(record.id, index);
    addTime(record, index);
  }
  records.forEach(add);
  return { ids, times, add, addTime, addId };
}

function mergeRecords(existing: RecordItem[], incoming: RecordItem[], choices: Record<string, RecordChoice>, counts: MergeCounts): { records: RecordItem[]; reviews: RecordReview[] } {
  const records = existing.slice(), base = existing.slice(), lookup = indexRecords(base);
  const reviews: RecordReview[] = [], changedTargets = new Set<number>();
  incoming.forEach((record, index) => {
    const targets = [...new Set([...(lookup.ids.get(record.id) ?? []), ...(lookup.times.get(second(record)) ?? [])])].sort((a, b) => a - b);
    if (targets.length === 0) {
      const target = base.length;
      base.push(record); records.push(record); lookup.add(record, target); counts.addedRecords++;
      return;
    }
    const candidates = targets.map((target) => ({ index: target, record: records[target] }));
    const matchToken = JSON.stringify(candidates.map((candidate) => [candidate.index, candidate.record.id, candidate.record.timestamp]));
    const decision = choices[index];
    const ambiguous = targets.length > 1;
    const target = !ambiguous ? targets[0] : decision?.matchToken === matchToken && targets.includes(decision.target ?? -1) ? decision.target : undefined;
    const review: RecordReview = { index, incoming: record, candidates, ambiguous, matchToken, target, conflict: false };
    if (target === undefined) { reviews.push(review); return; }
    // Keep incoming identity aliases for later records in this same merge.
    lookup.addId(record.id, target);
    const current = records[target];
    review.current = current;
    review.conflict = !sameRecordContent(current, record);
    if (!review.conflict) {
      counts.identical++;
      if (ambiguous) reviews.push(review);
      return;
    }
    // Choices are valid only for the exact target and comparison the user saw.
    review.valueToken = JSON.stringify([target, current.id, contentToken(current), contentToken(record)]);
    review.side = decision?.valueToken === review.valueToken ? decision.side : undefined;
    if (review.side === "current") counts.kept++;
    if (review.side === "backup") {
      records[target] = { ...record, id: current.id };
      lookup.addTime(record, target);
      changedTargets.add(target);
    }
    reviews.push(review);
  });
  const finalLookup = indexRecords(records);
  for (const review of reviews) {
    if (review.side !== "backup" || review.target === undefined) continue;
    const target = review.target;
    const result = records[target];
    const collisions = (finalLookup.times.get(second(result)) ?? []).filter((other) =>
      other !== target && second(base[target]) !== second(base[other]));
    if (collisions.length > 0) {
      review.collision = "적용 후 시각이 " + collisions.map((other) => (other + 1) + "번").join(", ") + " 기록과 새로 겹칩니다. 현재 기록을 유지하거나 연결 대상을 다시 선택해 주세요.";
    }
  }
  counts.updated += [...changedTargets].filter((target) => target < existing.length && JSON.stringify(existing[target]) !== JSON.stringify(records[target])).length;
  return { records, reviews };
}

export function planMerge(current: AppData, incoming: AppData, choices: MergeChoices): MergePlan {
  const data: AppData = { version: APP_DATA_VERSION, sessionsByDate: { ...current.sessionsByDate } };
  const sessions: MergeSession[] = [];
  const counts: MergeCounts = { addedDates: 0, addedSessions: 0, addedRecords: 0, identical: 0, kept: 0, updated: 0 };
  for (const [date, sourceSessions] of Object.entries(incoming.sessionsByDate)) {
    const original = current.sessionsByDate[date] ?? [], result = original.slice();
    const names = resolveSessionNames(sourceSessions), targets = new Map<number, number>();
    sourceSessions.forEach((_, index) => {
      const target = choices[sessionKey(date, index)]?.target;
      if (typeof target === "number") targets.set(target, (targets.get(target) ?? 0) + 1);
    });
    const dayRows: MergeSession[] = [];
    sourceSessions.forEach((source, index) => {
      const key = sessionKey(date, index), choice = choices[key];
      const row: MergeSession = { key, date, index, sourceName: names[index], source, target: choice?.target ?? null, reviews: [], issues: [] };
      sessions.push(row); dayRows.push(row);
      if (!choice || choice.target === null) { row.issues.push("연결할 세션 또는 새 세션 추가를 선택해 주세요."); return; }
      if (choice.target === "new") {
        const name = choice.name === undefined ? source.name : choice.name.trim() || undefined;
        row.resultIndex = result.length;
        result.push({ ...(name === undefined ? {} : { name }), records: source.records.slice() });
        counts.addedSessions++; counts.addedRecords += source.records.length;
        return;
      }
      if (!Number.isInteger(choice.target) || !original[choice.target]) { row.issues.push("연결할 현재 세션이 없습니다."); return; }
      if (targets.get(choice.target)! > 1) { row.issues.push("현재 세션 하나에는 백업 세션 하나만 연결할 수 있습니다."); return; }
      row.resultIndex = choice.target;
      const merged = mergeRecords(original[choice.target].records, source.records, choice.records, counts);
      result[choice.target] = { ...original[choice.target], records: merged.records };
      row.reviews = merged.reviews;
    });
    const resultNames = resolveSessionNames(result);
    const originalNames = resolveSessionNames(original);
    for (const row of dayRows) {
      if (row.resultIndex === undefined) continue;
      row.resultName = resultNames[row.resultIndex];
      if (row.target === "new") {
        const candidateName = result[row.resultIndex].name;
        if (candidateName !== undefined && (originalNames.some((name) => name.trim() === candidateName.trim()) ||
          row.resultName.trim() !== candidateName.trim() ||
          resultNames.some((name, index) => index !== row.resultIndex && name.trim() === candidateName.trim()))) {
          row.issues.push("새 세션의 이름이 겹칩니다. 이름을 바꾸거나 기존 세션에 연결해 주세요.");
        }
      }
    }
    if (result.length > 0) {
      data.sessionsByDate[date] = result;
      if (!(date in current.sessionsByDate)) counts.addedDates++;
    }
  }
  const pending = sessions.reduce((sum, row) => sum + row.issues.length + row.reviews.filter((review) =>
    review.target === undefined || (review.conflict && review.side === undefined) || review.collision !== undefined).length, 0);
  const changed = counts.addedDates + counts.addedSessions + counts.addedRecords > 0 ||
    sessions.some((row) => typeof row.target === "number" && row.resultIndex !== undefined &&
      data.sessionsByDate[row.date][row.resultIndex].records.some((record, index) =>
        record !== current.sessionsByDate[row.date][row.target as number].records[index] &&
        JSON.stringify(record) !== JSON.stringify(current.sessionsByDate[row.date][row.target as number].records[index])));
  return { data, sessions, counts, pending, changed };
}
