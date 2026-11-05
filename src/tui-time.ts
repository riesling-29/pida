/** Display timestamps in KST for terminal surfaces only; storage and APIs stay ISO/UTC. */
export function formatTuiTimestamp(iso: string, style: "time" | "datetime" = "datetime"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const base: Intl.DateTimeFormatOptions = { timeZone: "Asia/Seoul", hour12: false };
  const fmt = style === "time"
    ? new Intl.DateTimeFormat("ko-KR", { ...base, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : new Intl.DateTimeFormat("ko-KR", { ...base, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${fmt.format(date)} KST`;
}
