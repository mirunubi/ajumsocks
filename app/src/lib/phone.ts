export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
}

export function phoneToAuthEmail(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `${digits}@users.local.ajumsocks`;
}

export function formatPhoneInput(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.startsWith("010") && digits.length > 3) {
    const rest = digits.slice(3);
    if (rest.length <= 4) return `010-${rest}`;
    return `010-${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return input;
}

export function maskDisplayName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  if (national.length < 7) return "****";
  return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
}

export function formatE164Display(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  if (national.startsWith("010") && national.length === 11) {
    return `010-${national.slice(3, 7)}-${national.slice(7)}`;
  }
  return e164;
}

