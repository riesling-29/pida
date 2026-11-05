/** Display timestamps in KST for terminal surfaces only; storage and APIs stay ISO/UTC. */

const kst = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function kstToday(now = new Date()): string {
  return kst.formatToParts(now).find(p => p.type === "day")?.value ?? "";
}

export function formatTuiTimestamp(iso: string, style: "time" | "datetime" = "datetime", now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = kst.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  const sameDay = pick("day") === kstToday(now);
  const clock = `${pick("hour")}:${pick("minute")}:${pick("second")}`;
  if (style === "time") {
    return sameDay ? clock : `${pick("month")}-${pick("day")} ${clock}`;
  }
  return `${pick("year")}. ${pick("month")}. ${pick("day")}. ${clock} KST`;
}
