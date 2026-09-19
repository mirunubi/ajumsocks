import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { evaluateAccess, type AccessDenial, type Profile } from "./access";

type AuthState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  denial: AccessDenial | null;
};

const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    profile: null,
    denial: "missing",
  });

  useEffect(() => {
    let cancelled = false;

    async function applySession(session: Session | null) {
      if (!session) {
        if (!cancelled) {
          setState({ loading: false, session: null, profile: null, denial: "missing" });
        }
        return;
      }

      try {
        const profile = await loadProfile(session.user.id);
        if (!cancelled) {
          setState({
            loading: false,
            session,
            profile,
            denial: evaluateAccess(profile),
          });
        }
      } catch {
        if (!cancelled) {
          setState({ loading: false, session, profile: null, denial: "missing" });
        }
      }
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
