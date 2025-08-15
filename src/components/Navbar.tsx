"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import getSupabase from "@/lib/supabaseClient";

export default function Navbar() {
  const tabs = ["Snídaně", "Oběd", "Večeře", "Svačina", "Dezerty"];
  const searchParams = useSearchParams();
  const router = useRouter();

  const supabase = useMemo(() => getSupabase(), []);

  const aktivniKategorie = searchParams.get("kategorie");
  const aktivniHledani = searchParams.get("hledat") || "";
  const [hledat, setHledat] = useState(aktivniHledani);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => setHledat(aktivniHledani), [aktivniHledani]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setEmail(data.session?.user?.email ?? null);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
        if (mounted) setEmail(session?.user?.email ?? null);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [supabase]);

  function getClassName(tab: string | null) {
    const base = "rounded-2xl px-3 py-1 transition cursor-pointer";
    const active = "bg-black/40 text-white";
    const inactive = "bg-white/20 hover:bg-white/30 text-white";
    return `${base} ${aktivniKategorie === tab ? active : inactive}`;
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (aktivniKategorie) params.set("kategorie", aktivniKategorie);
    if (hledat.trim()) params.set("hledat", hledat.trim());
    router.push("/" + (params.toString() ? "?" + params.toString() : ""));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-10 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 text-white/95 shadow-lg">
      <nav className="mx-auto max-w-5xl flex items-center justify-between p-4 flex-wrap gap-2">
        <Link href="/" className="text-2xl font-extrabold">
          🥗 Receptář
        </Link>

        <div className="flex gap-2 flex-wrap items-center">
          <Link href="/" className={getClassName(null)}>Vše</Link>
          {tabs.map((t) => (
            <Link
              key={t}
              href={`/?kategorie=${encodeURIComponent(t)}`}
              className={getClassName(t)}
            >
              {t}
            </Link>
          ))}
          <Link
            href="/pridat"
            className="rounded-2xl px-3 py-1 bg-white/20 hover:bg-white/30 text-white"
          >
            + Přidat recept
          </Link>
          <Link
            href="/suroviny"
            className="rounded-2xl px-3 py-1 bg-white/20 hover:bg-white/30 text-white"
          >
            🧺 Moje suroviny
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <form onSubmit={onSearchSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Hledat recept..."
              className="px-3 py-1 rounded-lg text-black"
              value={hledat}
              onChange={(e) => setHledat(e.target.value)}
            />
            <button
              type="submit"
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg"
            >
              🔍
            </button>
          </form>

          {email ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-sm opacity-90">{email}</span>
              <button
                onClick={handleLogout}
                className="rounded-2xl px-3 py-1 bg-white/20 hover:bg-white/30"
                title="Odhlásit"
              >
                Odhlásit
              </button>
            </div>
          ) : (
            <Link
              href="/auth"
              className="rounded-2xl px-3 py-1 bg-white/20 hover:bg-white/30"
            >
              Přihlásit
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
