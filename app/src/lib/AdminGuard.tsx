import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/session";

function Loading() {
  return (
    <div className="app-shell center">
      <p className="muted">확인 중...</p>
    </div>
  );
}

export function AuthedGuard({ children }: { children: ReactNode }) {
  const { loading, session, profile, denial } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (denial || !profile) return <Navigate to="/" replace />;
  return children;
}

export function AdminGuard({ children }: { children: ReactNode }) {
  const { loading, session, profile, denial } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (denial || profile?.role !== "ADMIN") return <Navigate to="/" replace />;
  return children;
}
