import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AppRole, Profile } from "../lib/access";
import { callUserAdmin } from "../lib/functions";
import { inviteStatusLabel, type InviteStatus } from "../lib/inviteStatus";
import { formatE164Display, formatPhoneInput } from "../lib/phone";

type AdminUser = Profile & {
  last_sign_in_at: string | null;
  invite_status: InviteStatus;
  active_invite_id: string | null;
  created_at?: string;
};

const emptyForm = {
  display_name: "",
  phone: "",
  role: "PART_TIMER" as AppRole,
  login_allowed_from: "",
  login_allowed_until: "",
};

export function UsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | AppRole>("ALL");
  const [stateFilter, setStateFilter] = useState<"ALL" | "active" | "inactive" | "pending">("ALL");
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await callUserAdmin({ action: "list" });
    setUsers(result.users as AdminUser[]);
  }

  useEffect(() => {
    void refresh().catch((error: Error) => setMessage(error.message));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (stateFilter === "pending" && user.invite_status !== "pending") return false;
      if (stateFilter === "active" && (!user.is_active || user.invite_status === "pending")) return false;
      if (stateFilter === "inactive" && user.is_active) return false;
      if (!q) return true;
      return user.display_name.includes(q) || user.phone.includes(q) || formatE164Display(user.phone).includes(q);
    });
  }, [users, query, roleFilter, stateFilter]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setInviteUrl(null);
    try {
      const result = await callUserAdmin({
        action: "create",
        display_name: form.display_name,
        phone: form.phone,
        role: form.role,
        login_allowed_from: form.login_allowed_from ? new Date(`${form.login_allowed_from}T00:00:00`).toISOString() : null,
        login_allowed_until: form.login_allowed_until ? new Date(`${form.login_allowed_until}T23:59:59`).toISOString() : null,
      });
      if (result.exists) {
        setMessage("이미 등록된 전화번호입니다. 기존 사용자를 표시합니다.");
      } else {
        setInviteUrl(result.invite_url);
        setForm(emptyForm);
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(profileId: string) {
    setBusy(true);
    try {
      await callUserAdmin({ action: "revoke-invite", profile_id: profileId });
      setInviteUrl(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "취소 실패");
    } finally {
      setBusy(false);
    }
  }

  async function onReissue(profileId: string) {
    setBusy(true);
    try {
      const result = await callUserAdmin({ action: "reissue-invite", profile_id: profileId });
      setInviteUrl(result.invite_url);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재발급 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="nav-row">
        <Link to="/">← 홈</Link>
        <div className="brand">사용자 관리</div>
      </div>
      <h1>사용자 관리</h1>
      <p className="muted">공개 가입은 없습니다. 초대 링크를 카카오톡/문자로 직접 전달하세요.</p>

      <form className="card" onSubmit={(event) => void onCreate(event)}>
        <label>이름</label>
        <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
        <label>전화번호</label>
        <input
          inputMode="tel"
          placeholder="010-1234-5678"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
          required
        />
        <label>역할</label>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>
          <option value="ADMIN">ADMIN</option>
          <option value="STAFF">STAFF</option>
          <option value="PART_TIMER">PART_TIMER</option>
        </select>
        <label>로그인 시작일 (선택)</label>
        <input type="date" value={form.login_allowed_from} onChange={(e) => setForm({ ...form, login_allowed_from: e.target.value })} />
        {form.role === "PART_TIMER" ? <p className="muted">알바는 근무 시작/종료일을 넣는 것을 권장합니다.</p> : null}
        <label>로그인 종료일 (선택)</label>
        <input type="date" value={form.login_allowed_until} onChange={(e) => setForm({ ...form, login_allowed_until: e.target.value })} />
        <button type="submit" disabled={busy}>
          {busy ? "처리 중..." : "등록하고 초대 만들기"}
        </button>
      </form>

      {inviteUrl ? (
        <div className="card">
          <div className="muted">초대 링크 (이 화면에서만 다시 볼 수 있습니다)</div>
          <p className="invite-url">{inviteUrl}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void navigator.clipboard.writeText(inviteUrl)}
          >
            복사
          </button>
        </div>
      ) : null}
      {message ? <div className="error">{message}</div> : null}

      <input className="search" placeholder="이름 또는 전화번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="filters">
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "ALL" | AppRole)}>
          <option value="ALL">모든 역할</option>
          <option value="ADMIN">ADMIN</option>
          <option value="STAFF">STAFF</option>
          <option value="PART_TIMER">PART_TIMER</option>
        </select>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}>
          <option value="ALL">모든 상태</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
          <option value="pending">초대대기</option>
        </select>
      </div>

      {filtered.map((user) => (
        <article className="card user-card" key={user.id}>
          <strong>{user.display_name}</strong>
          {user.is_master ? <span className="badge">MASTER</span> : null}
          <div>{formatE164Display(user.phone)}</div>
          <div>
            <span className="badge">{user.role}</span>
            <span className="badge">{user.is_active ? "활성" : "비활성"}</span>
            <span className="badge">{inviteStatusLabel(user.invite_status)}</span>
          </div>
          <p className="muted">
            시작 {user.login_allowed_from ? user.login_allowed_from.slice(0, 10) : "제한 없음"} / 종료{" "}
            {user.login_allowed_until ? user.login_allowed_until.slice(0, 10) : "제한 없음"}
          </p>
          <p className="muted">최근 로그인 {user.last_sign_in_at ? user.last_sign_in_at.slice(0, 16).replace("T", " ") : "-"}</p>
          <p className="muted">등록 {user.created_at ? user.created_at.slice(0, 10) : "-"}</p>
          {!user.is_master && user.invite_status === "pending" ? (
            <div className="btn-row">
              <button type="button" className="secondary" disabled={busy} onClick={() => void onRevoke(user.id)}>
                초대 취소
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void onReissue(user.id)}>
                재발급
              </button>
            </div>
          ) : null}
          {!user.is_master && user.invite_status !== "pending" ? (
            <button type="button" className="secondary" disabled={busy} onClick={() => void onReissue(user.id)}>
              재초대
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
