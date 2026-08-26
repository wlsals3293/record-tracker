const KST = "Asia/Seoul";

function parts(timestamp: number): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
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

export function todayKst(): string { return kstDate(Date.now()); }

