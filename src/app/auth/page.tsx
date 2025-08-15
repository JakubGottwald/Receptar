"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function AuthPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("Přihlášeno ✅");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Účet vytvořen ✅ – jste přihlášen(a).");
      }
      router.push("/");
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Něco se nepovedlo.";
      setErr(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-6">
      <div className="card p-6">
        <h1 className="text-2xl font-bold mb-4">
          {mode === "signin" ? "Přihlášení" : "Registrace"}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            className="w-full border rounded px-3 py-2"
            placeholder="E-mail"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            className="w-full border rounded px-3 py-2"
            placeholder="Heslo (min. 6 znaků)"
            value={password}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {err && <div className="text-red-600 text-sm">{err}</div>}
          {msg && <div className="text-emerald-700 text-sm">{msg}</div>}

          <button className="btn-primary w-full disabled:opacity-70" disabled={loading}>
            {loading ? "Pracuji…" : mode === "signin" ? "Přihlásit se" : "Vytvořit účet"}
          </button>
        </form>

        <div className="mt-4 text-sm text-gray-600">
          {mode === "signin" ? (
            <>
              Nemáš účet?{" "}
              <button className="text-emerald-700 underline" onClick={() => setMode("signup")}>
                Zaregistruj se
              </button>
            </>
          ) : (
            <>
              Už máš účet?{" "}
              <button className="text-emerald-700 underline" onClick={() => setMode("signin")}>
                Přihlas se
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
