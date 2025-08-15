/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

/* ===== Typy ===== */
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

type Ingredient = {
  id: string;
  owner_id: string | null;
  name: string;
  vendor: string | null;
  protein: number;
  carbs: number;
  fat: number;
};

type Navrh = {
  name: string;
  prodejce?: string;
  protein: number;
  fat: number;
  carbs: number;
};
type Jednotka = "g" | "ml" | "ks";
type SurovinaEdit = Navrh & { mnozstvi: number; jednotka: Jednotka };

/* ===== Helpers / type guards ===== */
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

const isRecord = (o: unknown): o is Record<string, unknown> =>
  typeof o === "object" && o !== null;

const hasId = (o: unknown): o is { id: string | number } =>
  isRecord(o) &&
  "id" in o &&
  (typeof (o as Record<string, unknown>).id === "string" ||
    typeof (o as Record<string, unknown>).id === "number");

/* ===== Makra utils ===== */
function prepocitatMakra(s: SurovinaEdit): Required<Makra> {
  let p = s.protein;
  let f = s.fat;
  let c = s.carbs;
  if (s.jednotka === "g" || s.jednotka === "ml") {
    p = (p * s.mnozstvi) / 100;
    f = (f * s.mnozstvi) / 100;
    c = (c * s.mnozstvi) / 100;
  }
  const kcal = p * 4 + c * 4 + f * 9;
  return { protein: p, fat: f, carbs: c, kcal };
}

/** Parsuje řádek typu: "100 g Jogurt (Lidl)" nebo "2 ks Vejce" */
function parseRadek(radek: string) {
  const m = radek?.match?.(/^(\d+)\s*(g|ml|ks)\s+(.+?)(?:\s*\(([^)]+)\))?$/i);
  if (m) {
    return {
      mnozstvi: Number(m[1]),
      jednotka: m[2].toLowerCase() as Jednotka,
      name: m[3],
      prodejce: m[4] || undefined,
    };
  }
  return null;
}

/* ===== Komponenta ===== */
export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [rec, setRec] = useState<Recept | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit
  const [editMode, setEditMode] = useState(false);
  const [nazev, setNazev] = useState("");
  const [kategorie, setKategorie] = useState("");
  const [popis, setPopis] = useState("");
  const [surovinyEdit, setSurovinyEdit] = useState<SurovinaEdit[]>([]);
  const [novaSurovina, setNovaSurovina] = useState("");
  const [mojeSuroviny, setMojeSuroviny] = useState<Ingredient[]>([]);
  const [navrhy, setNavrhy] = useState<Navrh[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Načtení session + receptu + mých surovin
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      if (!mounted) return;
      setUserId(uid);

      // Recept
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .maybeSingle<DbRow>();

      if (!mounted) return;

      if (error) {
        console.error(error);
        setRec(null);
      } else if (!data) {
        // Fallback (kdyby byly legacy recepty v localStorage)
        try {
          const loc = JSON.parse(localStorage.getItem("recepty") || "[]");
          const found = Array.isArray(loc)
            ? loc.find((r: unknown) => hasId(r) && String(r.id) === String(id))
            : undefined;

          if (found && isRecord(found)) {
            const fallback: Recept = {
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
            };
            setRec(fallback);
          } else {
            setRec(null);
          }
        } catch {
          setRec(null);
        }
      } else {
        const recNorm: Recept = {
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
        };
        setRec(recNorm);
      }

      // Moje suroviny (jen moje)
      if (uid) {
        const { data: ingreds, error: ingErr } = await supabase
          .from("ingredients")
          .select("*")
          .eq("owner_id", uid)
          .order("name", { ascending: true });

        if (!mounted) return;
        if (ingErr) {
          console.error(ingErr);
          setMojeSuroviny([]);
        } else {
          setMojeSuroviny((ingreds ?? []) as Ingredient[]);
        }
      } else {
        setMojeSuroviny([]);
      }

      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase, id]);

  // Když zapnu edit, naplním formulář
  useEffect(() => {
    if (!editMode || !rec) return;
    setNazev(rec.nazev);
    setKategorie(rec.kategorie);
    setPopis(rec.popis ?? "");

    const prepared: SurovinaEdit[] =
      (rec.suroviny || []).map((radek, i) => {
        const parsed = parseRadek(radek);
        const m = rec.makra?.[i];

        let mnozstvi = 100 as number;
        let jednotka: Jednotka = "g";
        let name = radek;
        let prodejce: string | undefined;

        if (parsed) {
          mnozstvi = parsed.mnozstvi;
          jednotka = parsed.jednotka;
          name = parsed.name;
          prodejce = parsed.prodejce;
        }

        // odhad per-100g z uložených maker (pokud máme g/ml a známe množství)
        let p100 = m?.protein ?? 0;
        let f100 = m?.fat ?? 0;
        let c100 = m?.carbs ?? 0;
        if ((jednotka === "g" || jednotka === "ml") && m && mnozstvi > 0) {
          p100 = (m.protein * 100) / mnozstvi;
          f100 = (m.fat * 100) / mnozstvi;
          c100 = (m.carbs * 100) / mnozstvi;
        }

        return {
          name,
          prodejce,
          protein: p100,
          fat: f100,
          carbs: c100,
          mnozstvi,
          jednotka,
        };
      }) || [];

    setSurovinyEdit(prepared);
  }, [editMode, rec]);

  // Autocomplete z mých surovin
  useEffect(() => {
    const q = novaSurovina.trim().toLowerCase();
    if (!q) {
      setNavrhy([]);
      return;
    }
    const vysledky: Navrh[] = mojeSuroviny
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.vendor || "").toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((m) => ({
        name: m.name,
        prodejce: m.vendor ?? undefined,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
      }));
    setNavrhy(vysledky);
  }, [novaSurovina, mojeSuroviny]);

  /* ===== view součty ===== */
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
          {!userId && (
            <Link href="/auth" className="px-3 py-2 rounded border">Přihlásit</Link>
          )}
        </div>
      </main>
    );
  }

  /* ===== Akce v editoru ===== */
  function pridatSurovinu(n: Navrh) {
    setSurovinyEdit((prev) => [...prev, { ...n, mnozstvi: 100, jednotka: "g" }]);
    setNovaSurovina("");
    setNavrhy([]);
  }

  function pridatVlastniZRadku() {
    const parsed = parseRadek(novaSurovina.trim());
    const base: SurovinaEdit = parsed
      ? {
          name: parsed.name,
          prodejce: parsed.prodejce,
          protein: 0,
          fat: 0,
          carbs: 0,
          mnozstvi: parsed.mnozstvi,
          jednotka: parsed.jednotka,
        }
      : {
          name: novaSurovina.trim() || "Neznámá surovina",
          prodejce: undefined,
          protein: 0,
          fat: 0,
          carbs: 0,
          mnozstvi: 100,
          jednotka: "g",
        };
    setSurovinyEdit((prev) => [...prev, base]);
    setNovaSurovina("");
    setNavrhy([]);
  }

  function odstranitSurovinu(index: number) {
    setSurovinyEdit((prev) => prev.filter((_, i) => i !== index));
  }

  function upravitSurovinu(
    index: number,
    field: "mnozstvi" | "jednotka",
    value: number | Jednotka
  ) {
    setSurovinyEdit((prev) =>
      prev.map((it, i) => (i === index ? { ...it, [field]: value } : it))
    );
  }

  /* ===== Uložit změny do DB ===== */
  async function ulozitUpravy(e: React.FormEvent) {
    e.preventDefault();
    if (!rec || !userId) return;

    setSaving(true);
    setErr(null);

    const noveSuroviny = surovinyEdit.map(
      (s) => `${s.mnozstvi} ${s.jednotka} ${s.name}${s.prodejce ? ` (${s.prodejce})` : ""}`
    );
    const noveMakra = surovinyEdit.map((s) => prepocitatMakra(s));

    const { data, error } = await supabase
      .from("recipes")
      .update({
        nazev: nazev.trim(),
        kategorie: kategorie.trim(),
        popis: popis.trim() || null,
        suroviny: noveSuroviny,
        makra: noveMakra,
      })
      .eq("id", rec.id)
      .eq("owner_id", userId)
      .select("*")
      .maybeSingle<DbRow>();

    setSaving(false);

    if (error) {
      setErr(error.message);
      return;
    }

    if (data) {
      const updated: Recept = {
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
      };
      setRec(updated);
      setEditMode(false);
      router.refresh();
    }
  }

  /* ===== Smazat / Duplikovat ===== */
  async function odstranitRecept() {
    if (!rec || !userId) return;
    if (!confirm("Opravdu chceš tento recept smazat?")) return;

    const { error } = await supabase
      .from("recipes")
      .delete()
      .eq("id", rec.id)
      .eq("owner_id", userId);

    if (error) {
      alert(error.message);
      return;
    }
    router.push("/");
  }

  async function duplikovatRecept() {
    if (!rec || !userId) return;

    const { data, error } = await supabase
      .from("recipes")
      .insert({
        owner_id: userId,
        nazev: `${rec.nazev} (kopie)`,
        kategorie: rec.kategorie,
        popis: rec.popis,
        suroviny: rec.suroviny,
        makra: rec.makra,
        foto: rec.foto,
        stitky: rec.stitky,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error || !data) {
      alert(error?.message || "Nepodařilo se vytvořit kopii.");
      return;
    }
    router.push(`/recept/${data.id}`);
  }

type Totals = { protein: number; fat: number; carbs: number; kcal: number };

/* ===== Souhrn pro view ===== */
const sum: Totals = rec.makra.reduce<Totals>(
  (a, m) => {
    const kcal = typeof m.kcal === "number"
      ? m.kcal
      : (m.protein ?? 0) * 4 + (m.carbs ?? 0) * 4 + (m.fat ?? 0) * 9;

    return {
      protein: a.protein + (m.protein ?? 0),
      fat: a.fat + (m.fat ?? 0),
      carbs: a.carbs + (m.carbs ?? 0),
      kcal: a.kcal + kcal,
    };
  },
  { protein: 0, fat: 0, carbs: 0, kcal: 0 }
);


  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <button onClick={() => router.back()} className="px-3 py-2 rounded border">
        ← Zpět
      </button>

      {!editMode ? (
        <>
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
                  const kcal = m ? (m.kcal ?? (m.protein ?? 0) * 4 + (m.carbs ?? 0) * 4 + (m.fat ?? 0) * 9) : 0;
                  return m ? (
                    <li key={i}>
                      {s} – {m.protein.toFixed(1)} g bílkovin, {m.fat.toFixed(1)} g tuků,{" "}
                      {m.carbs.toFixed(1)} g sacharidů, {kcal.toFixed(0)} kcal
                    </li>
                  ) : (
                    <li key={i}>{s}</li>
                  );
                })}
              </ul>
            </section>
          )}

          {userId === rec.owner_id ? (
            <div className="flex gap-2 mt-6 flex-wrap">
              <button
                onClick={() => setEditMode(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                ✏ Upravit
              </button>
              <button
                onClick={odstranitRecept}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                🗑 Smazat
              </button>
              <button
                onClick={duplikovatRecept}
                className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
              >
                📄 Duplikovat
              </button>
            </div>
          ) : (
            <div className="mt-6 text-sm text-gray-600">
              Tento recept nepatří aktuálně přihlášenému uživateli, proto ho nelze upravovat.
            </div>
          )}
        </>
      ) : (
        <form onSubmit={ulozitUpravy} className="space-y-4 bg-white p-4 rounded shadow">
          <h2 className="text-xl font-semibold">Upravit recept</h2>

          {err && <div className="text-sm text-red-600">{err}</div>}

          <input
            className="w-full border rounded px-3 py-2"
            value={nazev}
            onChange={(e) => setNazev(e.target.value)}
            placeholder="Název receptu"
            required
          />
          <input
            className="w-full border rounded px-3 py-2"
            value={kategorie}
            onChange={(e) => setKategorie(e.target.value)}
            placeholder="Kategorie"
            required
          />
          <textarea
            className="w-full border rounded px-3 py-2"
            rows={4}
            value={popis}
            onChange={(e) => setPopis(e.target.value)}
            placeholder="Postup"
          />

          {/* Autocomplete z „Moje suroviny“ (jen vlastní) */}
          <div className="relative">
            <div className="flex items-center gap-2">
              <input
                className="w-full border rounded px-3 py-2"
                placeholder='Přidej surovinu z „Moje suroviny“… (např. "100 g Jogurt (Lidl)")'
                value={novaSurovina}
                onChange={(e) => setNovaSurovina(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (navrhy.length > 0) pridatSurovinu(navrhy[0]);
                    else pridatVlastniZRadku();
                  }
                }}
              />
              <button
                type="button"
                className="whitespace-nowrap text-sm px-3 py-2 rounded border hover:bg-gray-50"
                onClick={pridatVlastniZRadku}
                title="Přidat vlastní řádek"
              >
                Přidat řádek
              </button>
              <Link
                href="/suroviny"
                className="whitespace-nowrap text-sm px-3 py-2 rounded border hover:bg-gray-50"
                title="Přejít na Moje suroviny"
              >
                + Moje suroviny
              </Link>
            </div>

            {novaSurovina.trim() && navrhy.length === 0 && (
              <div className="mt-1 text-xs text-gray-500">
                Nic nenalezeno. Přidej položku v{" "}
                <Link href="/suroviny" className="underline">
                  Moje suroviny
                </Link>{" "}
                nebo klikni na „Přidat řádek“.
              </div>
            )}

            {navrhy.length > 0 && (
              <ul className="absolute z-10 bg-white border w-full max-h-60 overflow-auto rounded shadow">
                {navrhy.map((n, i) => (
                  <li
                    key={`${n.name}-${n.prodejce || ""}-${i}`}
                    onClick={() => pridatSurovinu(n)}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span>
                        {n.name}{" "}
                        {n.prodejce && (
                          <span className="text-xs text-gray-500">({n.prodejce})</span>
                        )}
                      </span>
                      <span className="text-sm text-gray-500">
                        P: {n.protein}g | T: {n.fat}g | S: {n.carbs}g
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Seznam editovaných surovin */}
          {surovinyEdit.length > 0 && (
            <ul className="mt-3 space-y-2">
              {surovinyEdit.map((s, i) => {
                const m = prepocitatMakra(s);
                return (
                  <li key={i} className="flex flex-col gap-1 border p-2 rounded">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {s.name}{" "}
                        {s.prodejce && (
                          <span className="text-xs text-gray-500">({s.prodejce})</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => odstranitSurovinu(i)}
                        className="text-red-500 hover:text-red-700"
                      >
                        ✖
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="number"
                        min={0}
                        className="w-24 border rounded px-2 py-1"
                        value={s.mnozstvi}
                        onChange={(e) => upravitSurovinu(i, "mnozstvi", Number(e.target.value))}
                      />
                      <select
                        className="border rounded px-2 py-1"
                        value={s.jednotka}
                        onChange={(e) => upravitSurovinu(i, "jednotka", e.target.value as Jednotka)}
                      >
                        <option value="g">g</option>
                        <option value="ml">ml</option>
                        <option value="ks">ks</option>
                      </select>
                      <span className="text-sm text-gray-600">
                        P: {m.protein.toFixed(1)}g | T: {m.fat.toFixed(1)}g | S: {m.carbs.toFixed(1)}g |{" "}
                        {m.kcal.toFixed(0)} kcal
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Tlačítka */}
          <div className="flex gap-2 flex-wrap">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-70"
            >
              {saving ? "Ukládám…" : "💾 Uložit"}
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500"
            >
              Zrušit
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
