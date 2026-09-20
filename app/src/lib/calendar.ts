import { kstYmd } from "./datetime";

export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function monthRangeIso(year: number, month: number): { from: string; to: string } {
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+09:00`);
  const next = addMonths(year, month, 1);
  const end = new Date(`${next.year}-${String(next.month).padStart(2, "0")}-01T00:00:00+09:00`);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}

export function weeksInMonth(year: number, month: number): Date[][] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w += 1) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor.getMonth() > month - 1 && cursor.getDay() === 0) break;
    if (cursor.getFullYear() > year || (cursor.getFullYear() === year && cursor.getMonth() > month - 1)) {
      if (cursor.getDay() === 0) break;
    }
  }
  return weeks;
}

export function ymdFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function eventOverlapsDay(startsAt: string, endsAt: string, day: string): boolean {
  return kstYmd(startsAt) <= day && day <= kstYmd(endsAt);
}
