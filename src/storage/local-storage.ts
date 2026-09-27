import { createInitialAppData, parseAppData, type AppData } from "../models/record";

export const STORAGE_KEY = "record-tracker-data";

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return createInitialAppData();
    const data = parseAppData(JSON.parse(raw) as unknown);
    return data ?? createInitialAppData();
  } catch {
    return createInitialAppData();
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

export function removeData(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Failed to remove data from localStorage:", error);
    return false;
  }
}
