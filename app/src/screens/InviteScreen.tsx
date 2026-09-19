import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { callInviteAccept } from "../lib/functions";
import { phoneToAuthEmail } from "../lib/phone";
import { supabase } from "../lib/supabase";

const errorText: Record<string, string> = {
  invalid_token: "유효하지 않은 초대입니다.",
  already_used: "이미 사용된 초대입니다.",
  revoked: "취소된 초대입니다.",
  expired: "만료된 초대입니다.",
  password_too_short: "비밀번호는 8자 이상이어야 합니다.",
};

export function InviteScreen() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{ display_name: string; phone: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void callInviteAccept({ action: "preview", token })
      .then(setPreview)
      .catch((err: Error) => setError(errorText[err.message] || err.message));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const accepted = await callInviteAccept({ action: "accept", token, password });
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: phoneToAuthEmail(accepted.phone),
        password,
      });
      if (signError) {
        navigate("/login", { replace: true });
        return;
      }
      navigate("/", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "invite_failed";
      setError(errorText[message] || message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="brand">아점삭스</div>
      <h1>비밀번호 설정</h1>
      {preview ? (
        <div className="card">
          <div>{preview.display_name}</div>
          <div className="muted">{preview.phone}</div>
        </div>
      ) : null}
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>새 비밀번호</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <label>비밀번호 확인</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {error ? <div className="error">{error}</div> : null}
        <button type="submit" disabled={busy || !preview}>
          {busy ? "처리 중..." : "설정하고 시작하기"}
        </button>
      </form>
    </div>
  );
}
