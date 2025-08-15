"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Session =
  | Awaited<
      ReturnType<ReturnType<typeof createClient>["auth"]["getSession"]>
    >["data"]["session"]
  | null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnon);

export default function DebugSupabase() {
  const [session, setSession] = useState<Session>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          setStatus("error");
        } else {
          setSession(data.session);
          setStatus("ok");
        }
      })
      .catch((e) => {
        setError(String(e));
        setStatus("error");
      });
  }, []);

  const shortKey = supabaseAnon ? supabaseAnon.slice(0, 8) + "…" : "(není)";

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Supabase debug</h1>

      <div className="card p-4">
        <div className="font-medium mb-2">ENV proměnné</div>
        <div className="text-sm">
          <div>
            <b>NEXT_PUBLIC_SUPABASE_URL:</b>{" "}
            {supabaseUrl || <em>(nenastaveno)</em>}
          </div>
          <div>
            <b>NEXT_PUBLIC_SUPABASE_ANON_KEY:</b> {shortKey}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="font-medium mb-2">auth.getSession()</div>
        {status === "idle" && <div>Načítám…</div>}
        {status === "ok" && (
          <pre className="text-xs bg-white/70 rounded p-3 overflow-auto">
            {JSON.stringify(session, null, 2)}
          </pre>
        )}
        {status === "error" && (
          <div className="text-red-700">Chyba: {error}</div>
        )}
      </div>
    </main>
  );
}
