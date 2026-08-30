const kstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function parts(timestamp: number): Record<string, string> {
  const formattedParts = kstFormatter.formatToParts(new Date(timestamp));
  const record: Record<string, string> = {};
  for (let i = 0; i < formattedParts.length; i++) {
    const part = formattedParts[i];
    if (part.type !== "literal") {
      record[part.type] = part.value;
    }
  }
  return record;
}

export function kstDate(timestamp: number): string {
  const value = parts(timestamp);
  return `${value.year}-${value.month}-${value.day}`;
}

export function kstTime(timestamp: number): string {
  const value = parts(timestamp);
  const hour = value.hour === "24" ? "00" : value.hour;
  return `${hour}:${value.minute}:${value.second}`;
}

export interface KstTimeParts {
  hour: string;
  minute: string;
  second: string;
}

export function kstTimeParts(timestamp: number): KstTimeParts {
  const value = parts(timestamp);
  const hour = value.hour === "24" ? "00" : value.hour;
  return {
    hour: hour.padStart(2, "0"),
    minute: value.minute.padStart(2, "0"),
    second: value.second.padStart(2, "0"),
  };
}

export function createKstTimestamp(dateStr: string, hour: number, minute: number, second: number): number {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  const s = String(second).padStart(2, "0");
  const iso = `${dateStr}T${h}:${m}:${s}+09:00`;
  return Date.parse(iso);
}

export function todayKst(): string {
  return kstDate(Date.now());
}


