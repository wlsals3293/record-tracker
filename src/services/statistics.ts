import type { RecordItem } from "../models/record";

export interface Statistics {
  totalCount: number;
  successCount: number;
  failCount: number;
  unspecifiedCount: number;
  totalMb: number;
  totalSeconds: number;
}

export function calculateStatistics(records: RecordItem[]): Statistics {
  return records.reduce<Statistics>(
    (total, record) => ({
      totalCount: total.totalCount + 1,
      successCount: total.successCount + (record.result === "success" ? 1 : 0),
      failCount: total.failCount + (record.result === "fail" ? 1 : 0),
      unspecifiedCount: total.unspecifiedCount + (record.result === null ? 1 : 0),
      totalMb: total.totalMb + (record.dataMb ?? 0),
      totalSeconds: total.totalSeconds + (record.lengthSeconds ?? 0),
    }),
    { totalCount: 0, successCount: 0, failCount: 0, unspecifiedCount: 0, totalMb: 0, totalSeconds: 0 }
  );
}

export function displayNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
}
