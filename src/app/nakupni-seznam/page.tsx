"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabaseClient";

/* ===================== Typy ===================== */
type Jednotka = "g" | "ml" | "ks";

type RecipeRow = {
  id: string;
  owner_id: string;
  nazev: string | null;
  suroviny: unknown;
};

type IngredientRow = {
  id: string;
  owner_id: string | null;
  name: string;
  vendor: string | null;
  protein: number;
  carbs: number;
  fat: number;
};

type ParsedLine = {
  name: string;
  vendor?: string;
  amount: number;
  unit: Jednotka;
};

type PlannedItem = {
  id: string;
  name: string;
  vendor?: string;
  amount: number;
  unit: Jednotka;
  checked: boolean;
  source: "recipe" | "extra";
};

type PlannedMeal = {
  recipeId?: string;
  items: PlannedItem[];
};

type DayMeals = {
  snidane: PlannedMeal;
  obed: PlannedMeal;
  vecere: PlannedMeal;
  extra: PlannedItem[];
};

type WeekPlan = Record<string, DayMeals>; // YYYY-MM-DD -> den

type StoredPlan = {
  version: 1;
  updatedAt: string; // ISO
  plan: WeekPlan;
};

type MealPlanRow = {
  plan: WeekPlan;
  updated_at: string;
};

type ExtraForm = { ingredientId: string; amount: string; unit: Jednotka };

/* ===================== Pomocné funkce ===================== */
const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

/** "100 g Jogurt bílý (Lidl)" => { amount:100, unit:"g", name:"Jogurt bílý", vendor:"Lidl" } */
function parseLine(line: string): ParsedLine {
  const m = line.match(/^(\d+)\s*(g|ml|ks)\s+(.+?)(?:\s*\(([^)]+)\))?$/i);
  if (m) {
    return {
      amount: Number(m[1]),
      unit: m[2].toLowerCase() as Jednotka,
      name: m[3],
      vendor: m[4] || undefined,
    };
  }
  return { amount: 1, unit: "ks", name: line };
}

/* —— UTC helpers pro stabilní klíče —— */
function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}
function mondayOfUTC(date: Date) {
  const dow = (date.getUTCDay() || 7) - 1; // 0..6 (Po..Ne)
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - dow);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}
function addDaysUTC(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function toIsoDateUTC(date: Date) {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayLabelLocal(d: Date) {
  const den = new Date(d.getTime()).toLocaleDateString("cs-CZ", { weekday: "long" });
  const datum = new Date(d.getTime()).toLocaleDateString("cs-CZ");
  return `${den.charAt(0).toUpperCase() + den.slice(1)} (${datum})`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyMeals(): DayMeals {
  return {
    snidane: { items: [] },
    obed: { items: [] },
    vecere: { items: [] },
    extra: [],
  };
}

function defaultPlan(days: Date[]): WeekPlan {
  const p: WeekPlan = {};
  for (const d of days) p[toIsoDateUTC(d)] = emptyMeals();
  return p;
}

function countUncheckedItems(plan: WeekPlan) {
  let c = 0;
  for (const k of Object.keys(plan)) {
    const d = plan[k];
    for (const it of d.snidane.items) if (!it.checked) c++;
    for (const it of d.obed.items) if (!it.checked) c++;
    for (const it of d.vecere.items) if (!it.checked) c++;
    for (const it of d.extra) if (!it.checked) c++;
  }
  return c;
}

/* ===================== LocalStorage ===================== */
function storageKey(uid: string, weekStartISO: string) {
  return `shopping-week:v1:${uid}:${weekStartISO}`;
}
function readStored(uid: string, weekStartISO: string): StoredPlan | null {
  try {
    const raw = localStorage.getItem(storageKey(uid, weekStartISO));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in (parsed as Record<string, unknown>) &&
      "updatedAt" in (parsed as Record<string, unknown>) &&
      "plan" in (parsed as Record<string, unknown>)
    ) {
      return parsed as StoredPlan;
    }
  } catch {
    /* ignore */
  }
  return null;
}
function writeStored(uid: string, weekStartISO: string, plan: WeekPlan) {
  try {
    const payload: StoredPlan = {
      version: 1,
      updatedAt: new Date().toISOString(),
      plan,
    };
    localStorage.setItem(storageKey(uid, weekStartISO), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
function deleteStored(uid: string, weekStartISO: string) {
  try {
    localStorage.removeItem(storageKey(uid, weekStartISO));
  } catch {
    /* ignore */
  }
}

/* ===================== Supabase (cloud) ===================== */
async function loadPlanFromCloud(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  weekStartISO: string
): Promise<MealPlanRow | null> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select("plan, updated_at")
    .eq("owner_id", ownerId)
    .eq("week_start", weekStartISO)
    .maybeSingle<MealPlanRow>();
  if (error || !data) return null;
  return data;
}

async function savePlanToCloud(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  weekStartISO: string,
  plan: WeekPlan
) {
  await supabase
    .from("meal_plans")
    .upsert(
      {
        owner_id: ownerId,
        week_start: weekStartISO, // ve schématu by to mělo být DATE
        plan,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,week_start" }
    );
}

/* ===================== Komponenta ===================== */
export default function NakupniSeznamPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  // Týdenní výběr (UTC) – základ je 1. 9. 2025
  const baseMondayUTC = useMemo(() => mondayOfUTC(utcDate(2025, 8, 1)), []);
  const [weekIndex, setWeekIndex] = useState(0);
  const weekStartUTC = useMemo(() => addDaysUTC(baseMondayUTC, weekIndex * 7), [baseMondayUTC, weekIndex]);
  const weekStartISO = toIsoDateUTC(weekStartUTC);
  const weekDaysUTC = useMemo(() => [...Array(7)].map((_, i) => addDaysUTC(weekStartUTC, i)), [weekStartUTC]);

  // Data
  const [recipes, setRecipes] = useState<Array<{ id: string; nazev: string; suroviny: string[] }>>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [plan, setPlan] = useState<WeekPlan>({});
  const [extraForms, setExtraForms] = useState<Record<string, ExtraForm>>({});
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState<"idle" | "saving" | "loading">("idle");

  // 1) Auth – držet v syncu a vědět, kdy je vyřešené
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
      setAuthResolved(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setAuthResolved(true);
    });
    return () => {
      mounted = false;
      sub.subscription?.unsubscribe();
    };
  }, [supabase]);

  // 2) Načti recepty/ingredience a MERGE plánu (anon/local/cloud) pro aktuální týden
  useEffect(() => {
    if (!authResolved) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      setHydrated(false);

      // Recepty
      const { data: rcp } = await supabase
        .from("recipes")
        .select("id, owner_id, nazev, suroviny")
        .order("created_at", { ascending: false });
      if (!mounted) return;
      const recs =
        (rcp as RecipeRow[] | null)?.map((r) => ({
          id: r.id,
          nazev: r.nazev ?? "(bez názvu)",
          suroviny: asStringArray(r.suroviny),
        })) ?? [];
      setRecipes(recs);

      // Moje suroviny
      if (userId) {
        const { data: ingr } = await supabase
          .from("ingredients")
          .select("*")
          .eq("owner_id", userId)
          .order("name", { ascending: true });
        if (!mounted) return;
        setIngredients((ingr ?? []) as IngredientRow[]);
      } else {
        setIngredients([]);
      }

      // ==== Merge plánu ====
      const empty = defaultPlan(weekDaysUTC);
      const localAnon = readStored("anon", weekStartISO);
      const localUser = userId ? readStored(userId, weekStartISO) : null;
      const remote = userId ? await loadPlanFromCloud(supabase, userId, weekStartISO) : null;

      const pick = (): WeekPlan => {
        const cands: Array<{ src: string; ts: number; plan: WeekPlan }> = [];
        if (localAnon) cands.push({ src: "anon", ts: Date.parse(localAnon.updatedAt), plan: localAnon.plan });
        if (localUser) cands.push({ src: "local", ts: Date.parse(localUser.updatedAt), plan: localUser.plan });
        if (remote) cands.push({ src: "remote", ts: Date.parse(remote.updated_at), plan: remote.plan });
        if (cands.length === 0) return empty;
        cands.sort((a, b) => {
          if (b.ts !== a.ts) return b.ts - a.ts; // novější
          return countUncheckedItems(b.plan) - countUncheckedItems(a.plan); // víc nezaškrtnutých
        });
        return cands[0].plan;
      };

      const merged = pick();
      setPlan(merged);

      if (userId) {
        writeStored(userId, weekStartISO, merged);      // local USER
        if (localAnon) deleteStored("anon", weekStartISO); // odmaž anon kopii pro týden
        try {
          setSyncing("loading");
          await savePlanToCloud(supabase, userId, weekStartISO, merged);
        } finally {
          setSyncing("idle");
        }
      } else {
        writeStored("anon", weekStartISO, merged);       // local ANON
      }

      // init mini formulářů
      const forms: Record<string, ExtraForm> = {};
      for (const d of weekDaysUTC) forms[toIsoDateUTC(d)] = { ingredientId: "", amount: "", unit: "g" };
      setExtraForms(forms);

      setHydrated(true);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [authResolved, userId, supabase, weekStartISO, weekDaysUTC]);

  // 3) Persist změn — lokálně hned, do cloudu s debounce; flush na visibilitychange
  useEffect(() => {
    if (!hydrated) return;
    const uid = userId ?? "anon";

    // lokál hned (to je klíčové pro refresh)
    writeStored(uid, weekStartISO, plan);

    if (!userId) return;

    // cloud s debounce
    setSyncing("saving");
    const t = setTimeout(() => {
      void savePlanToCloud(supabase, userId, weekStartISO, plan).finally(() => setSyncing("idle"));
    }, 400);

    // flush při skrytí/zavření tabu
    const flush = () => {
      clearTimeout(t);
      savePlanToCloud(supabase, userId, weekStartISO, plan).catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("beforeunload", flush);

    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush as any);
    };
  }, [plan, hydrated, userId, weekStartISO, supabase]);

  /* ===================== Akce UI ===================== */
  function setMealRecipe(dayIso: string, meal: keyof Omit<DayMeals, "extra">, recipeId: string) {
    setPlan((prev) => {
      const day = prev[dayIso] ?? emptyMeals();
      const r = recipes.find((x) => x.id === recipeId);
      const items: PlannedItem[] = r
        ? r.suroviny.map((line) => {
            const p = parseLine(line);
            return {
              id: uid(),
              name: p.name,
              vendor: p.vendor,
              amount: p.amount,
              unit: p.unit,
              checked: false,
              source: "recipe",
            };
          })
        : [];
      return { ...prev, [dayIso]: { ...day, [meal]: { recipeId, items } } };
    });
  }

  function toggleItem(dayIso: string, mealKey: keyof DayMeals, itemId: string) {
    setPlan((prev) => {
      const day = prev[dayIso] ?? emptyMeals();
      if (mealKey === "extra") {
        const updated = day.extra.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
        return { ...prev, [dayIso]: { ...day, extra: updated } };
      }
      const section = day[mealKey];
      const updated = section.items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
      return { ...prev, [dayIso]: { ...day, [mealKey]: { ...section, items: updated } } };
    });
  }

  function setExtraForm(dayIso: string, patch: Partial<ExtraForm>) {
    setExtraForms((prev) => ({ ...prev, [dayIso]: { ...prev[dayIso], ...patch } }));
  }

  function addExtra(dayIso: string) {
    const form = extraForms[dayIso];
    if (!form || !form.ingredientId) return;
    const ing = ingredients.find((i) => i.id === form.ingredientId);
    if (!ing) return;

    const amountNum = Number(form.amount);
    if (!form.amount || Number.isNaN(amountNum) || amountNum <= 0) return;

    setPlan((prev) => {
      const day = prev[dayIso] ?? emptyMeals();
      const newItem: PlannedItem = {
        id: uid(),
        name: ing.name,
        vendor: ing.vendor ?? undefined,
        amount: amountNum,
        unit: form.unit,
        checked: false,
        source: "extra",
      };
      return { ...prev, [dayIso]: { ...day, extra: [...day.extra, newItem] } };
    });

    setExtraForm(dayIso, { ingredientId: "", amount: "", unit: form.unit });
  }

  function removeExtra(dayIso: string, itemId: string) {
    setPlan((prev) => {
      const day = prev[dayIso] ?? emptyMeals();
      return { ...prev, [dayIso]: { ...day, extra: day.extra.filter((x) => x.id !== itemId) } };
    });
  }

  // Souhrn (nezaškrtnuté)
  type SumKey = `${string}||${string}||${Jednotka}`;
  const summary = useMemo(() => {
    const map = new Map<SumKey, number>();
    const push = (name: string, vendor: string | undefined, unit: Jednotka, amount: number) => {
      const key: SumKey = `${name}||${vendor ?? ""}||${unit}`;
      map.set(key, (map.get(key) ?? 0) + amount);
    };
    for (const iso of Object.keys(plan)) {
      const d = plan[iso];
      for (const m of [d.snidane, d.obed, d.vecere]) {
        for (const it of m.items) if (!it.checked) push(it.name, it.vendor, it.unit, it.amount);
      }
      for (const it of d.extra) if (!it.checked) push(it.name, it.vendor, it.unit, it.amount);
    }
    const rows = Array.from(map.entries()).map(([key, amount]) => {
      const [name, vendor, unit] = key.split("||") as [string, string, Jednotka];
      return { name, vendor: vendor || undefined, unit, amount };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    return rows;
  }, [plan]);

  /* ===================== UI ===================== */
  if (loading) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <div className="card p-6 text-gray-600">Načítám…</div>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="card p-6">
          <h1 className="text-2xl font-bold mb-2">🛒 Nákupní seznam</h1>
          <p className="text-gray-700">
            Pro plánování nákupů se prosím{" "}
            <Link className="text-emerald-700 underline" href="/auth">
              přihlas
            </Link>
            .
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Volby se ukládají do tohoto zařízení. Po přihlášení se automaticky přenesou k účtu a uvidíš je všude.
          </p>
        </div>
      </main>
    );
  }

  const weekRangeLocal =
    new Date(weekDaysUTC[0].getTime()).toLocaleDateString("cs-CZ") +
    " – " +
    new Date(weekDaysUTC[6].getTime()).toLocaleDateString("cs-CZ");

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Hlavička + výběr týdne */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold">🛒 Nákupní seznam</h1>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded border hover:bg-gray-50"
            onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}
            title="Předchozí týden"
          >
            ←
          </button>
          <div className="card px-4 py-2">
            <div className="text-sm text-gray-600">Týden</div>
            <div className="font-medium">{weekRangeLocal}</div>
          </div>
          <button
            className="px-3 py-2 rounded border hover:bg-gray-50"
            onClick={() => setWeekIndex((i) => i + 1)}
            title="Další týden"
          >
            →
          </button>
          <span
            className={
              syncing === "saving"
                ? "text-xs text-amber-600"
                : syncing === "loading"
                ? "text-xs text-gray-500"
                : "text-xs text-gray-400"
            }
          >
            {syncing === "saving" ? "Ukládám…" : syncing === "loading" ? "Načítám…" : "Uloženo"}
          </span>
        </div>
      </div>

      {/* Dny týdne */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {weekDaysUTC.map((day) => {
          const iso = toIsoDateUTC(day);
          const dayPlan = plan[iso] ?? emptyMeals();
          return (
            <article key={iso} className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{formatDayLabelLocal(day)}</div>
                <button
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={() =>
                    setPlan((p) => ({
                      ...p,
                      [iso]: emptyMeals(),
                    }))
                  }
                >
                  Vyčistit den
                </button>
              </div>

              {(
                [
                  ["Snídaně", "snidane"],
                  ["Oběd", "obed"],
                  ["Večeře", "vecere"],
                ] as const
              ).map(([label, key]) => {
                const mealKey = key as keyof Omit<DayMeals, "extra">;
                const meal = dayPlan[mealKey];
                return (
                  <div key={key} className="border rounded-lg p-3 bg-white/70">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-20 shrink-0 font-medium">{label}</div>
                      <select
                        className="border rounded px-2 py-1"
                        value={meal.recipeId ?? ""}
                        onChange={(e) => setMealRecipe(iso, mealKey, e.target.value)}
                      >
                        <option value="">– vybrat recept –</option>
                        {recipes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nazev}
                          </option>
                        ))}
                      </select>
                    </div>

                    {meal.items.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {meal.items.map((it) => (
                          <li key={it.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={it.checked}
                              onChange={() => toggleItem(iso, mealKey as keyof DayMeals, it.id)}
                              className="scale-110"
                            />
                            <span className={it.checked ? "line-through text-gray-400" : ""}>
                              {it.name}
                              {it.vendor ? ` (${it.vendor})` : ""} — {it.amount} {it.unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              {/* Další suroviny */}
              <div className="border rounded-lg p-3 bg-white/70">
                <div className="font-medium mb-2">Další suroviny</div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    className="border rounded px-2 py-1"
                    value={extraForms[iso]?.ingredientId ?? ""}
                    onChange={(e) => setExtraForm(iso, { ingredientId: e.target.value })}
                  >
                    <option value="">– vybrat z mých surovin –</option>
                    {ingredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name} {ing.vendor ? `(${ing.vendor})` : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    className="border rounded px-2 py-1 w-24"
                    placeholder="Množství"
                    inputMode="decimal"
                    value={extraForms[iso]?.amount ?? ""}
                    onChange={(e) => setExtraForm(iso, { amount: e.target.value })}
                  />
                  <select
                    className="border rounded px-2 py-1"
                    value={extraForms[iso]?.unit ?? "g"}
                    onChange={(e) => setExtraForm(iso, { unit: e.target.value as Jednotka })}
                  >
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                    <option value="ks">ks</option>
                  </select>
                  <button className="btn-primary" type="button" onClick={() => addExtra(iso)}>
                    Přidat
                  </button>
                </div>

                {dayPlan.extra.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {dayPlan.extra.map((it) => (
                      <li key={it.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={it.checked}
                          onChange={() => toggleItem(iso, "extra", it.id)}
                          className="scale-110"
                        />
                        <span className={it.checked ? "line-through text-gray-400" : ""}>
                          {it.name}
                          {it.vendor ? ` (${it.vendor})` : ""} — {it.amount} {it.unit}
                        </span>
                        <button
                          className="ml-auto text-sm text-red-600 hover:underline"
                          onClick={() => removeExtra(iso, it.id)}
                          type="button"
                          title="Odebrat"
                        >
                          Odebrat
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {/* Souhrn */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Souhrn na nákup (nezaškrtnuté položky)</h2>
          <button
            className="text-sm text-emerald-700 hover:underline"
            onClick={() => setPlan(defaultPlan(weekDaysUTC))}
          >
            Vyčistit celý týden
          </button>
        </div>

        {summary.length === 0 ? (
          <div className="text-gray-600 text-sm">Vše je odškrtnuté. 🧺</div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {summary.map((row, i) => (
              <li
                key={`${row.name}-${row.vendor ?? ""}-${row.unit}-${i}`}
                className="flex items-center justify-between"
              >
                <span className="truncate">
                  {row.name}
                  {row.vendor ? ` (${row.vendor})` : ""}
                </span>
                <span className="font-medium whitespace-nowrap">
                  {row.amount} {row.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
