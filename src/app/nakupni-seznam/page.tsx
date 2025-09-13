/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

type WeekPlan = Record<string, DayMeals>; // key = YYYY-MM-DD (Po..Ne)

/** Pro localStorage (metadata + plan) */
type StoredPlan = {
  version: 1;
  updatedAt: string; // ISO
  plan: WeekPlan;
};

/** Pro Supabase dotaz */
type MealPlanRow = {
  plan: WeekPlan;
  updated_at: string;
};

/** Mini-formulář pro "Další suroviny" (per den) */
type ExtraForm = { ingredientId: string; amount: string; unit: Jednotka };

/* ===================== Pomocné funkce (UTC-safe) ===================== */
// Vytvoř UTC datum (měsíc 0-based jako v JS Date)
function makeUTC(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}
function addDaysUTC(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}
function getUTCDay1to7(d: Date) {
  // Ne=7, Po=1 ... So=6
  const wd = d.getUTCDay(); // 0..6 (Ne..So)
  return wd === 0 ? 7 : wd;
}
function mondayOfUTC(date: Date) {
  const day = getUTCDay1to7(date); // 1..7
  const diff = day - 1; // kolik dní zpět
  return addDaysUTC(date, -diff);
}
function toIsoDateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabelLocal(dUTC: Date) {
  // Pouze pro display použijeme locale (datum i název dne), ale klíče držíme v UTC
  const local = new Date(dUTC.getTime());
  const den = local.toLocaleDateString("cs-CZ", { weekday: "long" });
  const datum = local.toLocaleDateString("cs-CZ");
  return `${den.charAt(0).toUpperCase() + den.slice(1)} (${datum})`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
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

// Parsování řádků surovin z receptu
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
const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

/* ===================== LocalStorage ===================== */
function storageKey(uid: string, weekStartISO: string) {
  return `shopping-week:v3:${uid}:${weekStartISO}`; // v3 = UTC klíče
}
function readStoredPlan(uid: string, weekStartISO: string): StoredPlan | null {
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
  } catch {}
  return null;
}
function writeStoredPlan(uid: string, weekStartISO: string, plan: WeekPlan) {
  try {
    const payload: StoredPlan = {
      version: 1,
      updatedAt: new Date().toISOString(),
      plan,
    };
    localStorage.setItem(storageKey(uid, weekStartISO), JSON.stringify(payload));
  } catch {}
}

/* ===================== Cloud (Supabase) ===================== */
async function loadPlanFromCloud(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  weekStartISO: string
): Promise<MealPlanRow | null> {
  const { data, error } = await supabase
    .from("meal_plans")
    .select("plan, updated_at")
    .eq("owner_id", ownerId)
    .eq("week_start", weekStartISO) // week_start doporučuji mít typ DATE
    .maybeSingle<MealPlanRow>();
  if (error || !data) return null;
  return data;
}

async function savePlanToCloud(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  weekStartISO: string,
  plan: WeekPlan
): Promise<void> {
  const { error } = await supabase
    .from("meal_plans")
    .upsert(
      {
        owner_id: ownerId,
        week_start: weekStartISO,
        plan,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,week_start" } // vyžaduje UNIQUE(owner_id, week_start)
    )
    .select("week_start")
    .maybeSingle();
  if (error) throw error;
}

/* ===================== Komponenta ===================== */
export default function NakupniSeznamPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);

  // Výchozí pondělí: 1. 9. 2025 (UTC)
  const baseMondayUTC = useMemo(() => mondayOfUTC(makeUTC(2025, 8, 1)), []);
  const [weekIndex, setWeekIndex] = useState(0);

  // Start týdne v UTC + ISO klíč + dny týdne (UTC)
  const weekStartUTC = useMemo(
    () => addDaysUTC(baseMondayUTC, weekIndex * 7),
    [baseMondayUTC, weekIndex]
  );
  const weekStartISO = toIsoDateUTC(weekStartUTC);
  const weekDaysUTC = useMemo(
    () => [...Array(7)].map((_, i) => addDaysUTC(weekStartUTC, i)),
    [weekStartUTC]
  );

  // Data
  const [recipes, setRecipes] = useState<Array<{ id: string; nazev: string; suroviny: string[] }>>(
    []
  );
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Plán týdne + hydratace
  const [plan, setPlan] = useState<WeekPlan>({});
  const [hydrated, setHydrated] = useState(false);

  // Formuláře "Další suroviny"
  type ExtraForm = { ingredientId: string; amount: string; unit: Jednotka };
  const [extraForms, setExtraForms] = useState<Record<string, ExtraForm>>({});

  // Sync indikace + ochrana proti závodům při přepínání týdne
  const [syncing, setSyncing] = useState<"idle" | "saving" | "loading" | "error">("idle");
  const latestWeekISORef = useRef<string>(weekStartISO);

  // Session
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  // Načtení: recepty, ingredience, plán (merge local/cloud) — POZOR: vše po UTC klíčích
  useEffect(() => {
    let mounted = true;
    latestWeekISORef.current = weekStartISO;

    (async () => {
      setLoading(true);
      setHydrated(false);
      setSyncing("loading");

      // Recepty (RLS vrátí jen vlastní)
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

      // Moje suroviny (jen vlastník)
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

      // Výchozí prázdný plán pro daný týden
      const empty = defaultPlan(weekDaysUTC);

      // Nepřihlášený: pouze localStorage (per týden/klíč)
      if (!userId) {
        const local = readStoredPlan("anon", weekStartISO);
        setPlan(local?.plan ?? empty);
        initExtraForms(weekDaysUTC);
        setHydrated(true);
        setLoading(false);
        setSyncing("idle");
        return;
      }

      // Přihlášený: merge local + cloud
      try {
        const [local, remote] = await Promise.all([
          Promise.resolve(readStoredPlan(userId, weekStartISO)),
          loadPlanFromCloud(supabase, userId, weekStartISO),
        ]);

        const pickPlan = (): WeekPlan => {
          if (!local && !remote) return empty;
          if (local && !remote) return local.plan;
          if (!local && remote) return remote.plan;
          const localTs = new Date(local!.updatedAt).getTime();
          const remoteTs = new Date(remote!.updated_at).getTime();
          if (remoteTs === localTs) {
            const lc = countUncheckedItems(local!.plan);
            const rc = countUncheckedItems(remote!.plan);
            return rc > lc ? remote!.plan : local!.plan;
          }
          return remoteTs > localTs ? remote!.plan : local!.plan;
        };

        const merged = pickPlan();
        if (!mounted || latestWeekISORef.current !== weekStartISO) return;

        setPlan(merged);
        writeStoredPlan(userId, weekStartISO, merged);
        try {
          await savePlanToCloud(supabase, userId, weekStartISO, merged);
          setSyncing("idle");
        } catch (e) {
          console.error("Cloud save (initial merge) failed:", e);
          setSyncing("error");
        }

        initExtraForms(weekDaysUTC);
        setHydrated(true);
        setLoading(false);
      } catch (e) {
        console.error(e);
        const fallback = empty;
        setPlan(fallback);
        if (userId) writeStoredPlan(userId, weekStartISO, fallback);
        initExtraForms(weekDaysUTC);
        setHydrated(true);
        setLoading(false);
        setSyncing("error");
      }
    })();

    function initExtraForms(daysUTC: Date[]) {
      const next: Record<string, ExtraForm> = {};
      for (const d of daysUTC) next[toIsoDateUTC(d)] = { ingredientId: "", amount: "", unit: "g" };
      setExtraForms(next);
    }

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId, weekStartISO]);

  // Ukládání: localStorage okamžitě; cloud s debounce (až po hydrataci)
  useEffect(() => {
    if (!hydrated) return;
    const uid = userId ?? "anon";
    writeStoredPlan(uid, weekStartISO, plan);

    if (!userId) return;

    setSyncing("saving");
    const currentWeek = weekStartISO;
    const t = setTimeout(() => {
      if (latestWeekISORef.current !== currentWeek) return;
      savePlanToCloud(supabase, userId, currentWeek, plan)
        .then(() => {
          if (latestWeekISORef.current === currentWeek) setSyncing("idle");
        })
        .catch((e) => {
          console.error("Cloud save (debounced) failed:", e);
          if (latestWeekISORef.current === currentWeek) setSyncing("error");
        });
    }, 500);
    return () => clearTimeout(t);
  }, [plan, hydrated, userId, weekStartISO, supabase]);

  /* ===== Helpers pro prázdný týden ===== */
  function emptyMeals(): DayMeals {
    return {
      snidane: { items: [] },
      obed: { items: [] },
      vecere: { items: [] },
      extra: [],
    };
  }
  function defaultPlan(daysUTC: Date[]): WeekPlan {
    const p: WeekPlan = {};
    for (const d of daysUTC) p[toIsoDateUTC(d)] = emptyMeals();
    return p;
  }

  /* ===== Volby jídel (dropdown s recepty) ===== */
  function setMealRecipe(dayIso: string, meal: keyof Omit<DayMeals, "extra">, recipeId: string) {
    setPlan((prev) => {
      const day = prev[dayIso] ?? emptyMeals();
      const r = recipes.find((x) => x.id === recipeId);
      const items: PlannedItem[] = r
        ? r.suroviny.map((line) => {
            const parsed = parseLine(line);
            return {
              id: uid(),
              name: parsed.name,
              vendor: parsed.vendor,
              amount: parsed.amount,
              unit: parsed.unit,
              checked: false,
              source: "recipe",
            };
          })
        : [];
      return {
        ...prev,
        [dayIso]: { ...day, [meal]: { recipeId, items } },
      };
    });
  }

  /* ===== Checkboxy pro položky ===== */
  function toggleItem(dayIso: string, mealKey: keyof DayMeals, itemId: string) {
    setPlan((prev) => {
      const day = prev[dayIso];
      if (!day) return prev;
      if (mealKey === "extra") {
        const updated = day.extra.map((it) =>
          it.id === itemId ? { ...it, checked: !it.checked } : it
        );
        return { ...prev, [dayIso]: { ...day, extra: updated } };
      }
      const section = day[mealKey];
      const updated = section.items.map((it) =>
        it.id === itemId ? { ...it, checked: !it.checked } : it
      );
      return { ...prev, [dayIso]: { ...day, [mealKey]: { ...section, items: updated } } };
    });
  }

  /* ===== Další suroviny ===== */
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
      const day = prev[dayIso];
      if (!day) return prev;
      return { ...prev, [dayIso]: { ...day, extra: day.extra.filter((x) => x.id !== itemId) } };
    });
  }

  /* ===== Souhrn (jen nezaškrtnuté) ===== */
  type SumKey = `${string}||${string}||${Jednotka}`;
  const summary = useMemo(() => {
    const map = new Map<SumKey, number>();
    const push = (name: string, vendor: string | undefined, unit: Jednotka, amount: number) => {
      const key: SumKey = `${name}||${vendor ?? ""}||${unit}`;
      map.set(key, (map.get(key) ?? 0) + amount);
    };

    for (const iso of Object.keys(plan)) {
      const d = plan[iso];
      for (const it of d.snidane.items) if (!it.checked) push(it.name, it.vendor, it.unit, it.amount);
      for (const it of d.obed.items) if (!it.checked) push(it.name, it.vendor, it.unit, it.amount);
      for (const it of d.vecere.items) if (!it.checked) push(it.name, it.vendor, it.unit, it.amount);
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
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Hlavička a výběr týdne */}
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
            <div className="font-medium">
              {weekDaysUTC[0].toLocaleDateString("cs-CZ")} – {weekDaysUTC[6].toLocaleDateString("cs-CZ")}
            </div>
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
                : syncing === "error"
                ? "text-xs text-red-600"
                : "text-xs text-gray-400"
            }
          >
            {syncing === "saving"
              ? "Ukládám…"
              : syncing === "loading"
              ? "Načítám…"
              : syncing === "error"
              ? "Chyba ukládání (lokálně uloženo)"
              : "Uloženo"}
          </span>
        </div>
      </div>

      {/* Mřížka dní */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {weekDaysUTC.map((dayUTC) => {
          const iso = toIsoDateUTC(dayUTC);
          const dayPlan = plan[iso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
          return (
            <article key={iso} className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{formatDayLabelLocal(dayUTC)}</div>
                <button
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={() =>
                    setPlan((p) => ({
                      ...p,
                      [iso]: { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] },
                    }))
                  }
                >
                  Vyčistit den
                </button>
              </div>

              {/* 3 jídla */}
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

                {/* Mini-form */}
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

                {/* Seznam extra */}
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

      {/* Celkový souhrn – bez checkboxů, jen součet nezaškrtnutých */}
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

      {/* Malý debug pruh – pomůže ověřit klíče (lze smazat) */}
      <div className="text-xs text-gray-500">
        WeekStartISO (UTC): <code>{weekStartISO}</code>
      </div>
    </main>
  );
}
