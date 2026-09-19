export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasAppAccess(profile: {
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
}, now = new Date()): boolean {
  if (!profile.is_active) return false;
  if (profile.login_allowed_from && now < new Date(profile.login_allowed_from)) return false;
  if (profile.login_allowed_until && now > new Date(profile.login_allowed_until)) return false;
  return true;
}
