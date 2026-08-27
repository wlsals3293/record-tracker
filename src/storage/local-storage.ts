import { APP_DATA_VERSION, parseAppData, type AppData } from "../models/record";

export const STORAGE_KEY = "record-tracker-data";

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { version: APP_DATA_VERSION, records: [] };
    const data = parseAppData(JSON.parse(raw) as unknown);
    return data ?? { version: APP_DATA_VERSION, records: [] };
  } catch {
    return { version: APP_DATA_VERSION, records: [] };
  }
}

export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Failed to save data to localStorage:", error);
    return false;
  }
}
