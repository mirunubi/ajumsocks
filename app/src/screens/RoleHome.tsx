import { Navigate } from "react-router-dom";
import { denialMessage, homePath } from "../lib/access";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";

export function RoleHome() {
  const { loading, session, profile, denial } = useAuth();

  if (loading) {
    return (
      <div className="app-shell center">
        <p className="muted">확인 중...</p>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  if (denial || !profile) {
    return (
      <div className="app-shell">
        <div className="brand">아점삭스</div>
        <h1>접근할 수 없습니다</h1>
        <p className="muted">{denial ? denialMessage(denial) : "등록된 업무 계정이 없습니다."}</p>
        <button className="secondary" type="button" onClick={() => void supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  return <Navigate to={homePath(profile.role)} replace />;
}
