import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";
import type { ReactNode } from "react";

export function AdminChrome({ title, children }: { title: string; children: ReactNode }) {
  const { profile } = useAuth();
  return (
    <div className="app-shell wide">
      <div className="admin-top">
        <div>
          <div className="brand">아점삭스 관리자</div>
          <h1>{title}</h1>
          <div className="muted">{profile?.display_name}</div>
        </div>
        <button className="secondary tiny-btn" type="button" onClick={() => void supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
      <nav className="admin-nav">
        <Link to="/admin">일정</Link>
        <Link to="/organizers">주최자</Link>
        <Link to="/events">행사목록</Link>
        <Link to="/events/new">행사등록</Link>
        <Link to="/products">상품</Link>
        <Link to="/users">사용자</Link>
        <Link to="/locations">재고위치</Link>
        <Link to="/operation-locations">운영거점</Link>
        <Link to="/preparations">준비물</Link>
      </nav>
      {children}
    </div>
  );
}
