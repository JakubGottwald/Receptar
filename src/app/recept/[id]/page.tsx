"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

/* ---------- Typy ---------- */
type Makra = { protein: number; fat: number; carbs: number; kcal?: number };

type DbRow = {
  id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  nazev: string | null;
  kategorie: string | null;
  popis: string | null;
  suroviny: unknown;  // jsonb
  makra: unknown;     // jsonb
  foto: string | null;
  stitky: unknown;    // jsonb
};

type Recept = {
  id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  nazev: string;
  kategorie: string;
  popis: string | null;
  suroviny: string[];
  makra: Makra[];
  foto: string | null;
  stitky: string[];
};

/* ---------- Pomocné převodníky ---------- */
const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

const asMakraArray = (x: unknown): Makra[] => {
  if (!Array.isArray(x)) return [];
  return x.map((m): Makra => {
    if (m && typeof m === "object") {
      const mm = m as Record<string, unknown>;
      const protein = typeof mm.protein === "number" ? mm.protein : 0;
      const fat = typeof mm.fat === "number" ? mm.fat : 0;
      const carbs = typeof mm.carbs === "number" ? mm.carbs : 0;
      const kcal = typeof mm.kcal === "number" ? (mm.kcal as number) : undefined;
      return { protein, fat, carbs, kcal };
    }
    return { protein: 0, fat: 0, carbs: 0 };
  });
};

/* ---------- Komponenta ---------- */
export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const router = useRouter();

  const supabase = useMemo(() => createClient(), []);

  const [rec, setRec] = useState<Recept | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<Record<string, unknown>>({});

  const calcKcal = (m: Makra) =>
    m.kcal ?? (m.protein || 0) * 4 + (m.carbs || 0) * 4 + (m.fat || 0) * 9;

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      setDebug((d) => ({ ...d, startedAt: new Date().toISOString(), idParam: id }));

      // 1) získej session (kvůli RLS a UX)
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      if (!mounted) return;
      setUserId(uid);

      // 2) natáhni recept z DB; uvidíš ho jen, pokud owner_id = uid (RLS)
      const { data, error } = await supabase
        .from("recipes")
        .select(
          "id, owner_id, created_at, updated_at, nazev, kategorie, popis, suroviny, makra, foto, stitky"
        )
        .eq("id", id)
        .single();

      if (!mounted) return;

      setDebug((d) => ({
        ...d,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        gotError: error?.message || null,
        gotData: !!data,
        userId: uid,
      }));

      if (error) {
        // typicky: 406/404 not found kvůli RLS nebo neexistující záznam
        setRec(null);
        setLoading(false);
        return;
      }

      const row = data as DbRow;

      const normalized: Recept = {
        id: row.id,
        owner_id: row.owner_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        nazev: row.nazev ?? "",
        kategorie: row.kategorie ?? "",
        popis: row.popis ?? null,
        suroviny: asStringArray(row.suroviny),
        makra: asMakraArray(row.makra),
        foto: row.foto ?? null,
        stitky: asStringArray(row.stitky),
      };

      setRec(normalized);
      setLoading(false);
    }

    if (id) run();
    else setLoading(false);

    return () => {
      mounted = false;
    };
  }, [id, supabase]);

  /* ---------- Render stavy ---------- */
  if (!id) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <p>Chybí ID receptu v URL.</p>
        <button onClick={() => router.push("/")} className="mt-3 px-3 py-2 rounded border">
          ← Zpět
        </button>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <p>Načítám…</p>
      </main>
    );
  }

  if (!rec) {
    return (
      <main className="max-w-3xl mx-auto p-6 space-y-3">
        <p className="text-red-700 font-semibold">Recept nenalezen.</p>
        <div className="text-sm text-gray-600">
          {userId
            ? "Recept neexistuje, nebo k němu nemáš přístup (RLS)."
            : "Nejsi přihlášen – bez přihlášení neuvidíš žádné recepty."}
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.back()} className="px-3 py-2 rounded border">← Zpět</button>
          {!userId && (
            <Link href="/auth" className="px-3 py-2 rounded border">Přihlásit</Link>
          )}
        </div>
        <details className="mt-4 text-xs">
          <summary>Debug</summary>
          <pre className="mt-2 bg-gray-50 p-2 rounded border overflow-auto">
{JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      </main>
    );
  }

  const sum = rec.makra.reduce(
    (a, m) => ({
      protein: a.protein + (m.protein || 0),
      fat: a.fat + (m.fat || 0),
      carbs: a.carbs + (m.carbs || 0),
      kcal: a.kcal + calcKcal(m),
    }),
    { protein: 0, fat: 0, carbs: 0, kcal: 0 }
  );

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <button onClick={() => router.back()} className="px-3 py-2 rounded border">← Zpět</button>

      {rec.foto && (
        <img
          src={rec.foto}
          alt={rec.nazev}
          className="w-full max-h-72 object-cover rounded-lg"
        />
      )}

      <h1 className="text-3xl font-bold mt-2">{rec.nazev}</h1>
      <p className="text-sm text-gray-500">{rec.kategorie}</p>

      {rec.stitky.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rec.stitky.map((t, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {rec.makra.length > 0 && (
        <div className="mt-4 bg-green-50 border border-green-200 p-4 rounded">
          <strong>Makra (součet):</strong>
          <div>Bílkoviny: {sum.protein.toFixed(1)} g</div>
          <div>Tuky: {sum.fat.toFixed(1)} g</div>
          <div>Sacharidy: {sum.carbs.toFixed(1)} g</div>
          <div>Energetická hodnota: {sum.kcal.toFixed(0)} kcal</div>
        </div>
      )}

      {rec.suroviny.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Suroviny</h2>
          <ul className="list-disc pl-5 mt-2">
            {rec.suroviny.map((s, i) => {
              const m = rec.makra[i];
              return m ? (
                <li key={i}>
                  {s} – {m.protein.toFixed(1)} g bílkovin, {m.fat.toFixed(1)} g tuků,{" "}
                  {m.carbs.toFixed(1)} g sacharidů, {calcKcal(m).toFixed(0)} kcal
                </li>
              ) : (
                <li key={i}>{s}</li>
              );
            })}
          </ul>
        </section>
      )}

      <details className="mt-6 text-xs">
        <summary>Debug</summary>
        <pre className="mt-2 bg-gray-50 p-2 rounded border overflow-auto">
{JSON.stringify({ id, userId, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }, null, 2)}
        </pre>
      </details>
    </main>
  );
}
