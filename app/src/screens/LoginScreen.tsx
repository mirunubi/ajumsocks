import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { denialMessage, evaluateAccess, homePath } from "../lib/access";
import { formatPhoneInput, normalizePhone, phoneToAuthEmail } from "../lib/phone";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";

export function LoginScreen({ variant = "field" }: { variant?: "admin" | "field" }) {
  const { loading, session, profile, denial } = useAuth();
  const location = useLocation();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const adminEntry = variant === "admin";

  if (!loading && session && !denial && profile && !submitting) {
    if (adminEntry && profile.role !== "ADMIN") {
      return <Navigate to="/my-events" replace />;
    }
    return <Navigate to={homePath(profile.role)} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError("전화번호를 입력하세요.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    setSubmitting(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: phoneToAuthEmail(normalized),
      password,
    });

    if (signInError || !data.user) {
      setSubmitting(false);
      setError("전화번호 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    const { data: nextProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    const reason = evaluateAccess(nextProfile);
    if (reason) {
      await supabase.auth.signOut();
      setSubmitting(false);
      setError(denialMessage(reason));
      return;
    }

    if (adminEntry && nextProfile?.role !== "ADMIN") {
      await supabase.auth.signOut();
      setSubmitting(false);
      setError("관리자 계정이 아닙니다.");
      return;
    }

    setSubmitting(false);
  }

  return (
    <div className="app-shell">
      <div className="brand">{adminEntry ? "아점삭스 관리자" : "아점삭스"}</div>
      <h1>{adminEntry ? "관리자 로그인" : "로그인"}</h1>
      <p className="muted">
        {adminEntry
          ? "관리자 전화번호와 비밀번호로 접속합니다. 공개 회원가입은 없습니다."
          : "오늘 행사에 접속하세요. 공개 회원가입은 없습니다."}
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor={`phone-${location.pathname}`}>전화번호</label>
        <input
          id={`phone-${location.pathname}`}
          inputMode="tel"
          autoComplete="tel"
          placeholder="010-1234-5678"
          value={phone}
          onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
        />
        <label htmlFor={`password-${location.pathname}`}>비밀번호</label>
        <input
          id={`password-${location.pathname}`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <div className="error">{error}</div> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "확인 중..." : adminEntry ? "관리자 로그인" : "로그인"}
        </button>
      </form>
    </div>
  );
}
