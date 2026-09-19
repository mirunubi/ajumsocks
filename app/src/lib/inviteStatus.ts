export type InviteStatus = "pending" | "accepted" | "expired" | "revoked" | "none";

export function inviteStatusLabel(status: InviteStatus): string {
  switch (status) {
    case "pending":
      return "초대대기";
    case "accepted":
      return "수락됨";
    case "expired":
      return "만료";
    case "revoked":
      return "취소";
    default:
      return "-";
  }
}
