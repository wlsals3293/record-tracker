export type RecordResult = "success" | "fail" | null;

export interface RecordItem {
  id: string;
  timestamp: number;
  result: RecordResult;
  dataMb: number | null;
  lengthSeconds: number | null;
}

export interface AppData {
  version: number;
  records: RecordItem[];
}

export const APP_DATA_VERSION = 1;

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
    isNonNegativeNumberOrNull(value.dataMb) && isNonNegativeNumberOrNull(value.lengthSeconds)
  );
}

export function parseAppData(value: unknown): AppData | null {
  if (!isObject(value) || value.version !== APP_DATA_VERSION || !Array.isArray(value.records)) return null;
  if (!value.records.every(isRecordItem)) return null;
  return { version: APP_DATA_VERSION, records: value.records };
}
