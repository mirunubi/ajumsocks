export type PaymentMethod = "CARD" | "CASH" | "OTHER";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CARD: "카드",
  CASH: "현금",
  OTHER: "기타",
};

export function formatWon(value: number | string | null | undefined) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${Math.trunc(n).toLocaleString("ko-KR")}원`;
}

export function parseWon(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  return Number(digits);
}

export function conflictMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (text === "conflict") return "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인하세요.";
  if (text === "date_out_of_range") return "행사기간 밖의 매출일은 입력할 수 없습니다.";
  return text;
}
