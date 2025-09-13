/* eslint-disable @next/next/no-img-element */
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

type WeekPlan = Record<string, DayMeals>; // key = YYYY-MM-DD (UTC Mon..Sun)

type StoredPlan = {
  version: 1;
  updatedAt: string;
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

/** "100 g Jogurt (Lidl)" → amount/unit/name/vendor */
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

/* ====== UTC datum utilitky (zamezí TZ bugům) ====== */
function utcDate(y: number, m0: number, d: number) {
  return new Date(Date.UTC(y, m0, d, 0, 0, 0, 0));
}
function mondayOfUTC(date: Date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Po=1..Ne=7
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function addUTCDays(d: Date, n: number) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return utcDate(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}
function toIsoDateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function formatDayLabelCZ(d: Date) {
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
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

/* ===================== LocalStorage ===================== */
function storageKey(uid: string, weekStartISO: string) {
  return `shopping-week:${uid}:${weekStartISO}`;
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
    const payload: StoredPlan = { version: 1, updatedAt: new Date().toISOString(), plan };
    localStorage.setItem(storageKey(uid, weekStartISO), JSON.stringify(payload));
  } catch {}
}

/* ===================== Supabase ===================== */
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
): Promise<void> {
  await supabase
    .from("meal_plans")
    .upsert(
      {
        owner_id: ownerId,
        week_start: weekStartISO,
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

  // Výběr týdne (UTC, od 1.9.2025)
  const baseMondayUTC = useMemo(() => mondayOfUTC(utcDate(2025, 8, 1)), []);
  const [weekIndex, setWeekIndex] = useState(0);
  const weekStartUTC = useMemo(
    () => addUTCDays(baseMondayUTC, weekIndex * 7),
    [baseMondayUTC, weekIndex]
  );
  const weekStartISO = toIsoDateUTC(weekStartUTC);
  const weekDaysUTC = useMemo(
    () => [...Array(7)].map((_, i) => addUTCDays(weekStartUTC, i)),
    [weekStartUTC]
  );

  // Data
  const [recipes, setRecipes] = useState<Array<{ id: string; nazev: string; suroviny: string[] }>>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Plán
  const [plan, setPlan] = useState<WeekPlan>({});
  const [hydrated, setHydrated] = useState(false);

  // Formuláře pro "Další suroviny"
  const [extraForms, setExtraForms] = useState<Record<string, ExtraForm>>({});

  // Sync indikace
  const [syncing, setSyncing] = useState<"idle" | "saving" | "loading">("idle");

  // Přihlášení
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

  // Helpers pro prázdný den/týden + normalizaci
  function emptyMeals(): DayMeals {
    return { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
  }
  function defaultPlan(days: Date[]): WeekPlan {
    const p: WeekPlan = {};
    for (const d of days) p[toIsoDateUTC(d)] = emptyMeals();
    return p;
  }
  function normalizeWeekStructure(src: WeekPlan, days: Date[]): WeekPlan {
    const norm: WeekPlan = {};
    for (const d of days) {
      const iso = toIsoDateUTC(d);
      const day = src[iso];
      if (!day) {
        norm[iso] = emptyMeals();
      } else {
        norm[iso] = {
          snidane: day.snidane ?? { items: [] },
          obed: day.obed ?? { items: [] },
          vecere: day.vecere ?? { items: [] },
          extra: Array.isArray(day.extra) ? day.extra : [],
        };
      }
    }
    return norm;
  }

  // Načti recepty/ingredience/plán pro daný týden
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setHydrated(false);

      // Recepty (RLS → jen tvoje)
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

      // Ingredients (jen pro přihlášeného)
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

      // Plán: local + cloud
      const empty = defaultPlan(weekDaysUTC);

      // Nepřihlášený → jen localStorage pod "anon"
      if (!userId) {
        const local = readStoredPlan("anon", weekStartISO);
        const merged = normalizeWeekStructure(local?.plan ?? empty, weekDaysUTC);
        setPlan(merged);
        initExtraForms(weekDaysUTC);
        setHydrated(true);
        setLoading(false);
        return;
      }

      setSyncing("loading");
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
          return countUncheckedItems(remote!.plan) > countUncheckedItems(local!.plan)
            ? remote!.plan
            : local!.plan;
        }
        return remoteTs > localTs ? remote!.plan : local!.plan;
      };

      const mergedRaw = pickPlan();
      const merged = normalizeWeekStructure(mergedRaw, weekDaysUTC);

      setPlan(merged);
      // Okamžitě zapiš vybraný do local i cloudu
      writeStoredPlan(userId, weekStartISO, merged);
      await savePlanToCloud(supabase, userId, weekStartISO, merged);

      setSyncing("idle");
      initExtraForms(weekDaysUTC);
      setHydrated(true);
      setLoading(false);
    })();

    function initExtraForms(days: Date[]) {
      const next: Record<string, ExtraForm> = {};
      for (const d of days) next[toIsoDateUTC(d)] = { ingredientId: "", amount: "", unit: "g" };
      setExtraForms(next);
    }

    return () => {
      mounted = false;
    };
  }, [supabase, userId, weekStartISO, weekDaysUTC]);

  // Ulož každou změnu: localStorage hned, Supabase hned (bez debounce)
  useEffect(() => {
    if (!hydrated) return;
    const uid = userId ?? "anon";
    writeStoredPlan(uid, weekStartISO, plan);

    if (!userId) return;
    setSyncing("saving");
    // okamžitý zápis do cloudu (bez čekání)
    void savePlanToCloud(supabase, userId, weekStartISO, plan).finally(() =>
      setSyncing("idle")
    );
  }, [plan, hydrated, userId, weekStartISO, supabase]);

  /* ===== Akce: výběr receptu do jídla ===== */
  function setMealRecipe(dayIso: string, meal: keyof Omit<DayMeals, "extra">, recipeId: string) {
    setPlan((prev) => {
      const day =
        prev[dayIso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
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
      return {
        ...prev,
        [dayIso]: { ...day, [meal]: { recipeId: recipeId || undefined, items } },
      };
    });
  }

  /* ===== Checkboxy ===== */
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
      const day =
        prev[dayIso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
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

  /* ===== Souhrn ===== */
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
        </div>
        <div className="card p-6 text-gray-700">
          Pro plánování nákupů se prosím{" "}
          <Link className="text-emerald-700 underline" href="/auth">
            přihlas
          </Link>
          .
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
                : "text-xs text-gray-400"
            }
          >
            {syncing === "saving" ? "Ukládám…" : syncing === "loading" ? "Načítám…" : "Uloženo"}
          </span>
        </div>
      </div>

      {/* Mřížka dní */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {weekDaysUTC.map((day) => {
          const iso = toIsoDateUTC(day);
          const dayPlan =
            plan[iso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
          return (
            <article key={iso} className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{formatDayLabelCZ(day)}</div>
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

      {/* Celkový souhrn */}
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
