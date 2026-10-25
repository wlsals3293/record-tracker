import { kstDate } from "../services/date";

export type RecordResult = "success" | "fail" | null;

export interface RecordItem {
  id: string;
  timestamp: number;
  result: RecordResult;
  /** Data size in MB; null means no value was entered. */
  size: number | null;
  /** Duration in seconds; null means no value was entered. */
  duration: number | null;
  memo?: string;
}

export interface Session {
  name?: string;
  records: RecordItem[];
}

export interface AppData {
  version: number;
  sessionsByDate: Record<string, Session[]>;
}

export function defaultSessionName(index: number): string {
  return `세션 ${index + 1}`;
}

// Reserve explicit names before assigning automatic names in session order.
// automaticIndex previews restoring one session to an automatic name.
export function resolveSessionNames(sessions: readonly Session[], automaticIndex = -1): string[] {
  const names = sessions.map((session, index) =>
    index === automaticIndex || session.name === undefined || session.name === defaultSessionName(index)
      ? ""
      : session.name,
  );
  for (let index = 0; index < names.length; index++) {
    if (names[index] !== "") continue;
    let nameIndex = index;
    let name = defaultSessionName(nameIndex);
    while (names.some((existing) => existing.trim() === name)) {
      name = defaultSessionName(++nameIndex);
    }
    names[index] = name;
  }
  return names;
}

function withoutDefaultSessionName(session: Session, index: number): Session {
  if (session.name === undefined || session.name !== defaultSessionName(index)) return session;
  const result = { ...session };
  delete result.name;
  return result;
}

// Shared by local storage and full-data backups.
export function serializeAppData(data: AppData): string {
  return JSON.stringify({
    version: APP_DATA_VERSION,
    sessionsByDate: Object.fromEntries(
      Object.entries(data.sessionsByDate).map(([date, sessions]) => [
        date,
        sessions.map((session, index) => ({
          ...withoutDefaultSessionName(session, index),
          records: session.records.map(serializeRecord),
        })),
      ]),
    ),
  });
}

export const APP_DATA_VERSION = 3;

// Only the optional metrics are omitted. In particular, zero and result: null survive.
export function serializeRecord(record: RecordItem): Omit<RecordItem, "size" | "duration"> & { size?: number; duration?: number } {
  return {
    id: record.id,
    timestamp: record.timestamp,
    result: record.result,
    ...(record.size === null ? {} : { size: record.size }),
    ...(record.duration === null ? {} : { duration: record.duration }),
    ...(record.memo === undefined ? {} : { memo: record.memo }),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeNumberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

function parseMetric(value: Record<string, unknown>, key: string, legacyKey: string): number | null | undefined {
  const hasCurrent = Object.hasOwn(value, key), hasLegacy = Object.hasOwn(value, legacyKey);
  if (hasCurrent && !isNonNegativeNumberOrNull(value[key])) return undefined;
  if (hasLegacy && !isNonNegativeNumberOrNull(value[legacyKey])) return undefined;
  // Reject conflicting aliases rather than silently discarding either value.
  if (hasCurrent && hasLegacy && value[key] !== value[legacyKey]) return undefined;
  return (hasCurrent ? value[key] : hasLegacy ? value[legacyKey] : null) as number | null;
}

// Normalize every storage/import boundary to the same explicit internal fields.
export function parseRecordItem(value: unknown): RecordItem | null {
  if (!isObject(value) ||
    typeof value.id !== "string" || value.id.length === 0 ||
    typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp) ||
    (value.result !== "success" && value.result !== "fail" && value.result !== null) ||
    (value.memo !== undefined && typeof value.memo !== "string")) return null;
  const size = parseMetric(value, "size", "dataMb");
  const duration = parseMetric(value, "duration", "lengthSeconds");
  if (size === undefined || duration === undefined) return null;
  return {
    id: value.id, timestamp: value.timestamp, result: value.result, size, duration,
    ...(value.memo === undefined ? {} : { memo: value.memo }),
  };
}

export function parseRecords(value: unknown): RecordItem[] | null {
  if (!Array.isArray(value)) return null;
  const records: RecordItem[] = [];
  for (const item of value) {
    const record = parseRecordItem(item);
    if (record === null) return null;
    records.push(record);
  }
  return records;
}

function parseSession(value: unknown): Session | null {
  if (!isObject(value) ||
    (value.name !== undefined && (typeof value.name !== "string" || value.name.trim().length === 0))) return null;
  const records = parseRecords(value.records);
  if (records === null) return null;
  return { ...(value.name === undefined ? {} : { name: value.name }), records };
}

function groupRecordsByDate(records: RecordItem[]): Record<string, Session[]> {
  const sessionsByDate: Record<string, Session[]> = {};
  for (const record of records) {
    const date = kstDate(record.timestamp);
    const dateSessions = sessionsByDate[date] ?? (sessionsByDate[date] = [{ records: [] }]);
    dateSessions[0].records.push(record);
  }
  return sessionsByDate;
}

export function createInitialAppData(records: RecordItem[] = []): AppData {
  return {
    version: APP_DATA_VERSION,
    sessionsByDate: groupRecordsByDate(records),
  };
}

export function parseAppData(value: unknown): AppData | null {
  if (!isObject(value)) return null;

  if (value.version === 2 || value.version === APP_DATA_VERSION) {
    if (!isObject(value.sessionsByDate)) return null;
    const days: [string, Session[]][] = [];
    for (const [date, rawSessions] of Object.entries(value.sessionsByDate)) {
      if (!Array.isArray(rawSessions)) return null;
      const sessions: Session[] = [];
      for (const rawSession of rawSessions) {
        const session = parseSession(rawSession);
        if (session === null) return null;
        sessions.push(withoutDefaultSessionName(session, sessions.length));
      }
      days.push([date, sessions.length > 0 ? sessions : [{ records: [] }]]);
    }
    return {
      version: APP_DATA_VERSION,
      sessionsByDate: Object.fromEntries(days),
    };
  }

  // Migrate existing single-list storage into the first session on the next save.
  if (value.version === 1) {
    const records = parseRecords(value.records);
    return records === null ? null : createInitialAppData(records);
  }

  return null;
}
