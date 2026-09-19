const KST = "Asia/Seoul";

function part(iso: string, type: Intl.DateTimeFormatPartTypes, options: Intl.DateTimeFormatOptions) {
  return (
    new Intl.DateTimeFormat("en-CA", { timeZone: KST, ...options }).formatToParts(new Date(iso)).find((item) => item.type === type)
      ?.value ?? ""
  );
}

export function isoToDatetimeLocalKst(iso: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const year = part(iso, "year", options);
  const month = part(iso, "month", options);
  const day = part(iso, "day", options);
  const hour = part(iso, "hour", options);
  const minute = part(iso, "minute", options);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function datetimeLocalKstToIso(local: string): string {
  if (!local) return "";
  const value = local.length === 16 ? `${local}:00` : local;
  return new Date(`${value}+09:00`).toISOString();
}

export function formatKstDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    month: "numeric",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatKstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function formatKstRange(startsAt: string, endsAt: string): string {
  return `${formatKstDate(startsAt)} ~ ${formatKstDate(endsAt)}`;
}

export function scheduleHint(startsAt: string, endsAt: string, now = new Date()): "예정" | "진행기간" | "종료됨" {
  if (now.getTime() < Date.parse(startsAt)) return "예정";
  if (now.getTime() > Date.parse(endsAt)) return "종료됨";
  return "진행기간";
}
