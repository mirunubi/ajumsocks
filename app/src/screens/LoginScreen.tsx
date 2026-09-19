import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { denialMessage, evaluateAccess } from "../lib/access";
import { formatPhoneInput, normalizePhone, phoneToAuthEmail } from "../lib/phone";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/session";

export function LoginScreen() {
  const { loading, session, denial } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session && !denial) {
    return <Navigate to="/" replace />;
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    const reason = evaluateAccess(profile);
    if (reason) {
      await supabase.auth.signOut();
      setSubmitting(false);
      setError(denialMessage(reason));
      return;
    }

    setSubmitting(false);
  }

  return (
    <div className="app-shell">
      <div className="brand">아점삭스</div>
      <h1>로그인</h1>
      <p className="muted">등록된 전화번호와 비밀번호로 접속합니다. 공개 회원가입은 없습니다.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="phone">전화번호</label>
        <input
          id="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="010-1234-5678"
          value={phone}
          onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
        />
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <div className="error">{error}</div> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "확인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
