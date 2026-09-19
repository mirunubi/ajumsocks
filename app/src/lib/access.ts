export type AppRole = "ADMIN" | "STAFF" | "PART_TIMER";

export type Profile = {
  id: string;
  role: AppRole;
  display_name: string;
  phone: string;
  is_master: boolean;
  is_active: boolean;
  login_allowed_from: string | null;
  login_allowed_until: string | null;
};

export type AccessDenial = "inactive" | "not_started" | "expired" | "missing";

export function evaluateAccess(profile: Profile | null, now = new Date()): AccessDenial | null {
  if (!profile) return "missing";
  if (!profile.is_active) return "inactive";
  if (profile.login_allowed_from && now < new Date(profile.login_allowed_from)) return "not_started";
  if (profile.login_allowed_until && now > new Date(profile.login_allowed_until)) return "expired";
  return null;
}

export function denialMessage(reason: AccessDenial): string {
  switch (reason) {
    case "inactive":
      return "비활성화된 계정입니다. 관리자에게 문의하세요.";
    case "not_started":
      return "아직 로그인 허용 기간이 시작되지 않았습니다.";
    case "expired":
      return "로그인 허용 기간이 종료되었습니다.";
    default:
      return "등록된 업무 계정이 없습니다. 관리자에게 문의하세요.";
  }
}
