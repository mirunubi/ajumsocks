export type ScheduleStatus = "TENTATIVE" | "CONFIRMED";
export type SetupSessionStatus = "PLANNED" | "ARRIVED" | "COMPLETED";
export type SetupFixtureType = "TABLE" | "RACK" | "DISPLAY" | "HANGER" | "SIGNAGE" | "OTHER";
export type SetupMemberRole = "LEAD" | "MEMBER";
export type SetupPhotoType = "ARRIVAL" | "COMPLETION" | "OTHER";
export type OperationLocationType = "OFFICE" | "HOME_BASE" | "LODGING" | "STORAGE" | "OTHER";
export type TransitionSubject = "GEAR" | "CREW" | "BOTH";

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  TENTATIVE: "예정",
  CONFIRMED: "확정",
};

export const SETUP_STATUS_LABEL: Record<SetupSessionStatus, string> = {
  PLANNED: "계획",
  ARRIVED: "도착",
  COMPLETED: "완료",
};

export const FIXTURE_TYPE_LABEL: Record<SetupFixtureType, string> = {
  TABLE: "테이블",
  RACK: "렉",
  DISPLAY: "진열",
  HANGER: "행거",
  SIGNAGE: "안내물",
  OTHER: "기타",
};

export const SETUP_ROLE_LABEL: Record<SetupMemberRole, string> = {
  LEAD: "세팅 책임자",
  MEMBER: "세팅 인원",
};

export const OPERATION_LOCATION_LABEL: Record<OperationLocationType, string> = {
  OFFICE: "사무실",
  HOME_BASE: "거점",
  LODGING: "숙소",
  STORAGE: "창고",
  OTHER: "기타",
};

export const TRANSITION_SUBJECT_LABEL: Record<TransitionSubject, string> = {
  GEAR: "짐",
  CREW: "사람",
  BOTH: "사람+짐",
};

export function mmToMetersLabel(mm: number | null | undefined): string {
  if (mm == null) return "—";
  const meters = mm / 1000;
  return `${meters.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}m`;
}

export function dimsLabel(widthMm: number | null, depthMm: number | null, heightMm?: number | null): string {
  const parts = [widthMm, depthMm, heightMm].filter((value): value is number => value != null).map(mmToMetersLabel);
  return parts.join(" × ");
}

export function scheduleSortRank(status: string, scheduleStatus: string): number {
  if (status === "CANCELLED") return 2;
  if (scheduleStatus === "TENTATIVE") return 1;
  return 0;
}
