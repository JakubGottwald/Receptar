"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient"; // ⬅️ pojmenovaný import
import type { User } from "@supabase/supabase-js";

type AuthCtx = { user: User | null; loading: boolean };
const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
        if (mounted) setUser(session?.user ?? null);
      });

      // uložit cleanup
      unsubscribe = () => sub.subscription.unsubscribe();
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [supabase]);

  return <Ctx.Provider value={{ user, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
