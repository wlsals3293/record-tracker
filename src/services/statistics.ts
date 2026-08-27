import type { RecordItem } from "../models/record";

export interface Statistics {
  totalCount: number;
  successCount: number;
  failCount: number;
  unspecifiedCount: number;
  totalMb: number;
  totalSeconds: number;
}

export function calculateStatistics(records: readonly RecordItem[]): Statistics {
  let totalCount = 0;
  let successCount = 0;
  let failCount = 0;
  let unspecifiedCount = 0;
  let totalMb = 0;
  let totalSeconds = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    totalCount++;
    if (record.result === "success") {
      successCount++;
    } else if (record.result === "fail") {
      failCount++;
    } else {
      unspecifiedCount++;
    }
    if (record.dataMb !== null) {
      totalMb += record.dataMb;
    }
    if (record.lengthSeconds !== null) {
      totalSeconds += record.lengthSeconds;
    }
  }

  return {
    totalCount,
    successCount,
    failCount,
    unspecifiedCount,
    totalMb,
    totalSeconds,
  };
}

const numberFormatters = new Map<number, Intl.NumberFormat>();

export function displayNumber(value: number, maximumFractionDigits = 2): string {
  let formatter = numberFormatters.get(maximumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits });
    numberFormatters.set(maximumFractionDigits, formatter);
  }
  return formatter.format(value);
}
