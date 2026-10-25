import type { AppData } from "../models/record";
import { todayKst } from "../services/date";

// Browser-only navigation preference; never part of AppData or backups.
export const CURRENT_SESSION_KEY = "record-tracker-current-session";

export interface CurrentSession {
  date: string;
  index: number;
}

export function loadCurrentSession(data: AppData): CurrentSession {
  const fallback = { date: todayKst(), index: 0 };
  try {
    const raw = localStorage.getItem(CURRENT_SESSION_KEY);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return fallback;
    const { date, index } = value as Partial<CurrentSession>;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return fallback;
    const timestamp = Date.parse(date + "T00:00:00Z");
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return fallback;
    const count = data.sessionsByDate[date]?.length || 1;
    return { date, index: typeof index === "number" && Number.isInteger(index) && index >= 0 && index < count ? index : 0 };
  } catch {
    return fallback;
  }
}

export function saveCurrentSession(date: string, index: number): void {
  try {
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify({ date, index }));
  } catch {
    // A blocked preference store must not interrupt record editing.
  }
}
