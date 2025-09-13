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

/** LocalStorage payload */
type StoredPlan = {
  version: 1;
  updatedAt: string; // ISO
  plan: WeekPlan;
};

/** Supabase row */
type MealPlanRow = {
  plan: WeekPlan;
  updated_at: string; // ISO
};

/** Mini-form "Další suroviny" */
type ExtraForm = { ingredientId: string; amount: string; unit: Jednotka };

/* ===================== Utils ===================== */
const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

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
  // fallback
  return { amount: 1, unit: "ks", name: line };
}

function formatDayLabel(d: Date) {
  const den = d.toLocaleDateString("cs-CZ", { weekday: "long" });
  const datum = d.toLocaleDateString("cs-CZ");
  return `${den.charAt(0).toUpperCase() + den.slice(1)} (${datum})`;
}

function mondayOf(date: Date) {
  const d = new Date(date);
  const day = d.getDay() || 7; // 1..7, 0=Ne
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function vendorLabel(v?: string | null) {
  return v ? ` (${v})` : "";
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
function removeStoredPlan(uid: string, weekStartISO: string) {
  try {
    localStorage.removeItem(storageKey(uid, weekStartISO));
  } catch {}
}

/* ===================== Cloud (Supabase) ===================== */
async function loadPlanFromCloud(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  weekStartISO: string
): Promise<MealPlanRow | null> {
  const { data } = await supabase
    .from("meal_plans")
    .select("plan, updated_at")
    .eq("owner_id", ownerId)
    .eq("week_start", weekStartISO)
    .maybeSingle<MealPlanRow>();
  return data ?? null;
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
      { owner_id: ownerId, week_start: weekStartISO, plan, updated_at: new Date().toISOString() },
      { onConflict: "owner_id,week_start" }
    );
}

/* ===================== Komponenta ===================== */
export default function NakupniSeznamPage() {
  const supabase = useMemo(() => createClient(), []);

  /* --- Auth: čekáme, než budeme vědět, jestli je user přihlášen --- */
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
      setAuthReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  /* --- Výběr týdne (od 1. 9. 2025) --- */
  const baseMonday = useMemo(() => new Date(2025, 8, 1), []); // 1.9.2025
  const [weekIndex, setWeekIndex] = useState(0);
  const weekStart = useMemo(() => {
    const d = new Date(baseMonday);
    d.setDate(d.getDate() + weekIndex * 7);
    return mondayOf(d);
  }, [baseMonday, weekIndex]);
  const weekStartISO = toIsoDate(weekStart);
  const weekDays = [...Array(7)].map((_, i) => addDays(weekStart, i));

  /* --- Data --- */
  const [recipes, setRecipes] = useState<Array<{ id: string; nazev: string; suroviny: string[] }>>(
    []
  );
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* --- Plán týdne --- */
  const [plan, setPlan] = useState<WeekPlan>({});
  const [hydrated, setHydrated] = useState(false);
  const lastSavedSnapshot = useRef<string>("");
  const [syncing, setSyncing] = useState<"idle" | "saving" | "loading">("idle");

  /* --- Extra form --- */
  const [extraForms, setExtraForms] = useState<Record<string, ExtraForm>>({});

  /* === Pomocné pro prázdný týden === */
  function emptyMeals(): DayMeals {
    return { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
  }
  function defaultPlan(days: Date[]): WeekPlan {
    const p: WeekPlan = {};
    for (const d of days) p[toIsoDate(d)] = emptyMeals();
    return p;
  }

  /* === Načti všechno pro aktuální týden (až když známe auth) === */
  useEffect(() => {
    if (!authReady) return; // Klíčové: nespouštěj loader dřív, než víme userId!

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

      // Suroviny (jen moje)
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

      // Zdroje plánu: local(user), cloud(user), local(anon)
      const empty = defaultPlan(weekDays);
      const localUser = readStoredPlan(userId ?? "anon", weekStartISO); // když userId null, čte "anon"
      let chosen: WeekPlan | null = localUser?.plan ?? null;

      // Když je user přihlášen, zvaž i cloud a případný ANON plán (migrace)
      if (userId) {
        // načti vše
        setSyncing("loading");
        const [remote, localForUser, localAnon] = await Promise.all([
          loadPlanFromCloud(supabase, userId, weekStartISO),
          Promise.resolve(readStoredPlan(userId, weekStartISO)),
          Promise.resolve(readStoredPlan("anon", weekStartISO)),
        ]);

        // vyber nejnovější ze tří (remote, localUser, localAnon)
        type Candidate = { plan: WeekPlan; ts: number; src: "remote" | "localUser" | "anon" };
        const candidates: Candidate[] = [];
        if (remote) candidates.push({ plan: remote.plan, ts: new Date(remote.updated_at).getTime(), src: "remote" });
        if (localForUser)
          candidates.push({ plan: localForUser.plan, ts: new Date(localForUser.updatedAt).getTime(), src: "localUser" });
        if (localAnon)
          candidates.push({ plan: localAnon.plan, ts: new Date(localAnon.updatedAt).getTime(), src: "anon" });

        if (candidates.length === 0) {
          chosen = empty;
        } else {
          // najdi max ts, při shodě použij počet nezaškrtnutých jako tie-breaker
          candidates.sort((a, b) => {
            if (b.ts !== a.ts) return b.ts - a.ts;
            return countUncheckedItems(b.plan) - countUncheckedItems(a.plan);
          });
          const best = candidates[0];
          chosen = best.plan;

          // MIGRACE: pokud vyhrál "anon", zapiš ho uživateli do local + cloud a smaž "anon"
          if (best.src === "anon") {
            writeStoredPlan(userId, weekStartISO, best.plan);
            await savePlanToCloud(supabase, userId, weekStartISO, best.plan);
            removeStoredPlan("anon", weekStartISO);
          }
        }
        setSyncing("idle");
      }

      const finalPlan = chosen ?? empty;
      if (!mounted) return;

      setPlan(finalPlan);
      lastSavedSnapshot.current = JSON.stringify(finalPlan);
      writeStoredPlan(userId ?? "anon", weekStartISO, finalPlan);
      if (userId) {
        await savePlanToCloud(supabase, userId, weekStartISO, finalPlan);
      }

      // init mini-formů
      const forms: Record<string, ExtraForm> = {};
      for (const d of weekDays) forms[toIsoDate(d)] = { ingredientId: "", amount: "", unit: "g" };
      setExtraForms(forms);

      setHydrated(true);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, userId, weekStartISO, supabase]);

  /* === Ukládání změn === */
  useEffect(() => {
    if (!hydrated) return;
    const snap = JSON.stringify(plan);

    // local – vždy
    writeStoredPlan(userId ?? "anon", weekStartISO, plan);

    // cloud – jen přihlášený a jen pokud je to nová změna
    if (!userId) return;
    if (snap === lastSavedSnapshot.current) return;

    setSyncing("saving");
    let cancelled = false;
    (async () => {
      await savePlanToCloud(supabase, userId, weekStartISO, plan);
      if (!cancelled) {
        lastSavedSnapshot.current = snap;
        setSyncing("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, hydrated, userId, weekStartISO, supabase]);

  /* === Akce UI === */
  function setMealRecipe(dayIso: string, meal: keyof Omit<DayMeals, "extra">, recipeId: string) {
    setPlan((prev) => {
      const day = prev[dayIso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
      if (!recipeId) {
        return { ...prev, [dayIso]: { ...day, [meal]: { recipeId: undefined, items: [] } } };
      }
      const r = recipes.find((x) => x.id === recipeId);
      const items: PlannedItem[] = r
        ? r.suroviny.map((line) => {
            const { name, vendor, amount, unit } = parseLine(line);
            return { id: uid(), name, vendor, amount, unit, checked: false, source: "recipe" };
          })
        : [];
      return { ...prev, [dayIso]: { ...day, [meal]: { recipeId, items } } };
    });
  }

  function toggleItem(dayIso: string, mealKey: keyof DayMeals, itemId: string) {
    setPlan((prev) => {
      const day = prev[dayIso];
      if (!day) return prev;
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
    if (!form?.ingredientId) return;
    const ing = ingredients.find((i) => i.id === form.ingredientId);
    if (!ing) return;

    const amountNum = Number(form.amount);
    if (!form.amount || Number.isNaN(amountNum) || amountNum <= 0) return;

    setPlan((prev) => {
      const day = prev[dayIso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
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

  /* === Souhrn nezaškrtnutých === */
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

  /* === UI === */
  if (!authReady || loading) {
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
              {weekDays[0].toLocaleDateString("cs-CZ")} – {weekDays[6].toLocaleDateString("cs-CZ")}
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
        {weekDays.map((day) => {
          const iso = toIsoDate(day);
          const dayPlan = plan[iso] ?? { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] };
          return (
            <article key={iso} className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{formatDayLabel(day)}</div>
                <button
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={() => setPlan((p) => ({ ...p, [iso]: { snidane: { items: [] }, obed: { items: [] }, vecere: { items: [] }, extra: [] } }))}
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
                              {vendorLabel(it.vendor)} — {it.amount} {it.unit}
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
                        {ing.name}
                        {vendorLabel(ing.vendor)}
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
                          {vendorLabel(it.vendor)} — {it.amount} {it.unit}
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
            onClick={() => setPlan(defaultPlan(weekDays))}
          >
            Vyčistit celý týden
          </button>
        </div>

        {summary.length === 0 ? (
          <div className="text-gray-600 text-sm">Vše je odškrtnuté. 🧺</div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {summary.map((row, i) => (
              <li key={`${row.name}-${row.vendor ?? ""}-${row.unit}-${i}`} className="flex items-center justify-between">
                <span className="truncate">
                  {row.name}
                  {vendorLabel(row.vendor)}
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
