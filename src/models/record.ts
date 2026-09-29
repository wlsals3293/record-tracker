import { kstDate } from "../services/date";

export type RecordResult = "success" | "fail" | null;

export interface RecordItem {
  id: string;
  timestamp: number;
  result: RecordResult;
  dataMb: number | null;
  lengthSeconds: number | null;
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

function withoutDefaultSessionName(session: Session, index: number): Session {
  if (session.name === undefined || session.name !== defaultSessionName(index)) return session;
  const result = { ...session };
  delete result.name;
  return result;
}

// Shared by local storage and future full-data backups.
export function serializeAppData(data: AppData): string {
  return JSON.stringify({
    ...data,
    sessionsByDate: Object.fromEntries(
      Object.entries(data.sessionsByDate).map(([date, sessions]) => [
        date,
        sessions.map(withoutDefaultSessionName),
      ]),
    ),
  });
}

export const APP_DATA_VERSION = 2;
const LEGACY_DATA_VERSION = 1;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeNumberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

export function isRecordItem(value: unknown): value is RecordItem {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.timestamp === "number" && Number.isFinite(value.timestamp) &&
    (value.result === "success" || value.result === "fail" || value.result === null) &&
    isNonNegativeNumberOrNull(value.dataMb) && isNonNegativeNumberOrNull(value.lengthSeconds) &&
    (value.memo === undefined || typeof value.memo === "string")
  );
}

function isSession(value: unknown): value is Session {
  if (!isObject(value)) return false;
  return (
    (value.name === undefined || (typeof value.name === "string" && value.name.trim().length > 0)) &&
    Array.isArray(value.records) && value.records.every(isRecordItem)
  );
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

  if (value.version === APP_DATA_VERSION) {
    if (!isObject(value.sessionsByDate)) return null;
    const dateSessions = Object.values(value.sessionsByDate);
    if (!dateSessions.every((sessions) => Array.isArray(sessions) && sessions.every(isSession))) return null;
    const sessionsByDate = value.sessionsByDate as Record<string, Session[]>;
    return {
      version: APP_DATA_VERSION,
      sessionsByDate: Object.fromEntries(
        Object.entries(sessionsByDate).map(([date, sessions]) => [
          date,
          sessions.length > 0 ? sessions.map(withoutDefaultSessionName) : [{ records: [] }],
        ]),
      ),
    };
  }

  // Migrate existing single-list storage into the first session on the next save.
  if (value.version === LEGACY_DATA_VERSION && Array.isArray(value.records) && value.records.every(isRecordItem)) {
    return createInitialAppData(value.records);
  }

  return null;
}
