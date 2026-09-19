export function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
}

export function phoneToAuthEmail(e164) {
  const digits = e164.replace(/\D/g, "");
  return `${digits}@users.local.ajumsocks`;
}

export function maskPhone(e164) {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  if (national.length < 7) return "****";
  return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
}
