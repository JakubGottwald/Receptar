/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

type Makra = { protein: number; fat: number; carbs: number; kcal?: number };

type DbRow = {
  id: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  nazev: string | null;
  kategorie: string | null;
  popis: string | null;
  suroviny: unknown;
  makra: unknown;
  foto: string | null;
  stitky: unknown;
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

const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

const asMakraArray = (x: unknown): Makra[] => {
  if (!Array.isArray(x)) return [];
  return x.map((m): Makra => {
    if (m && typeof m === "object") {
      const mm = m as Record<string, unknown>;
      return {
        protein: typeof mm.protein === "number" ? mm.protein : 0,
        fat: typeof mm.fat === "number" ? mm.fat : 0,
        carbs: typeof mm.carbs === "number" ? mm.carbs : 0,
        kcal: typeof mm.kcal === "number" ? (mm.kcal as number) : undefined,
      };
    }
    return { protein: 0, fat: 0, carbs: 0 };
  });
};

type Debug = Record<string, unknown>;
const isRecord = (o: unknown): o is Record<string, unknown> =>
  typeof o === "object" && o !== null;
const hasId = (o: unknown): o is { id: string | number } =>
  isRecord(o) && ("id" in o) && (typeof (o as Record<string, unknown>).id === "string" || typeof (o as Record<string, unknown>).id === "number");

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [rec, setRec] = useState<Recept | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<Debug | null>(null);

  async function fetchRecipe() {
    setLoading(true);
    setDebug((prev) => ({ ...(prev ?? {}), startedAt: new Date().toISOString() }));

    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id ?? null;
    setUserId(uid);

    const { data, error } = await supabase
      .from("recipes")
      .select("*")
      .eq("id", id)
      .maybeSingle<DbRow>();

    setDebug((prev) => ({
      ...(prev ?? {}),
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      idParam: id,
      userId: uid,
      gotError: error?.message || null,
      gotNull: !data,
    }));

    if (error) {
      console.error(error);
      setRec(null);
      setLoading(false);
      return;
    }

    if (!data) {
      // fallback na localStorage (přechodně)
      try {
        const loc = JSON.parse(localStorage.getItem("recepty") || "[]");
        const found = Array.isArray(loc)
          ? loc.find((r: unknown) => hasId(r) && String(r.id) === String(id))
          : undefined;

        if (found && isRecord(found)) {
          setRec({
            id: String(found.id as string | number),
            owner_id: uid || "",
            created_at: "",
            updated_at: "",
            nazev: typeof found.nazev === "string" ? found.nazev : "",
            kategorie: typeof found.kategorie === "string" ? found.kategorie : "",
            popis: typeof found.popis === "string" ? found.popis : null,
            suroviny: asStringArray(found.suroviny),
            makra: asMakraArray(found.makra),
            foto: typeof found.foto === "string" ? found.foto : null,
            stitky: asStringArray(found.stitky),
          });
        } else {
          setRec(null);
        }
      } catch {
        setRec(null);
      }
      setLoading(false);
      return;
    }

    setRec({
      id: data.id,
      owner_id: data.owner_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      nazev: data.nazev ?? "",
      kategorie: data.kategorie ?? "",
      popis: data.popis,
      suroviny: asStringArray(data.suroviny),
      makra: asMakraArray(data.makra),
      foto: data.foto,
      stitky: asStringArray(data.stitky),
    });
    setLoading(false);
  }

  useEffect(() => {
    fetchRecipe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const calcKcal = (m: Makra) =>
    m.kcal ?? (m.protein ?? 0) * 4 + (m.carbs ?? 0) * 4 + (m.fat ?? 0) * 9;

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
            ? "Buď neexistuje, nebo není tvůj (RLS)."
            : "Nejsi přihlášen – bez přihlášení neuvidíš žádné recepty."}
        </div>

        <div className="flex gap-2">
          <button onClick={() => router.back()} className="px-3 py-2 rounded border">
            ← Zpět
          </button>
          <button
            onClick={fetchRecipe}
            className="px-3 py-2 rounded border bg-emerald-600 text-white"
          >
            Force fetch z DB
          </button>
          {!userId && (
            <Link href="/auth" className="px-3 py-2 rounded border">
              Přihlásit
            </Link>
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

  type Totals = { protein: number; fat: number; carbs: number; kcal: number };
  const sum: Totals = rec.makra.reduce<Totals>(
    (a, m) => ({
      protein: a.protein + (m.protein ?? 0),
      fat: a.fat + (m.fat ?? 0),
      carbs: a.carbs + (m.carbs ?? 0),
      kcal: a.kcal + calcKcal(m),
    }),
    { protein: 0, fat: 0, carbs: 0, kcal: 0 }
  );

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <button onClick={() => router.back()} className="px-3 py-2 rounded border">
        ← Zpět
      </button>

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
              className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border"
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
