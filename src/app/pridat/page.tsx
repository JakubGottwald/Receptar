"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

/* ===== Typy ===== */
type Makra = { protein: number; fat: number; carbs: number; kcal?: number };
type Navrh = { name: string; protein: number; fat: number; carbs: number; vendor?: string | null };
type Surovina = Navrh & { mnozstvi: number; jednotka: string };

type Ingredient = {
  id: string;
  owner_id: string | null;
  name: string;
  vendor: string | null;
  protein: number;
  carbs: number;
  fat: number;
};

type TagGroupKey = "Tagy" | "Kuchyně" | "Období" | "Ingredience" | "Doba přípravy";

/* ===== Výchozí nabídky štítků (rozšiřitelné v UI) ===== */
const DEFAULT_TAGS: Record<TagGroupKey, string[]> = {
  Tagy: ["S videem", "Bez laktózy", "Bez lepku", "Keto", "Low carb", "Vegan", "Vegetarian"],
  Kuchyně: ["Americká kuchyně", "Asijská kuchyně", "Italská kuchyně", "Mexická kuchyně", "Řecká kuchyně"],
  Období: ["Jaro", "Léto", "Podzim", "Zima", "Silvestr", "Vánoce", "Velikonoce"],
  Ingredience: ["Ovesné vločky", "Banán", "Bílý jogurt", "Avokádo", "Arašídové máslo"],
  "Doba přípravy": ["Do 15 minut", "Do 30 minut", "Do 60 minut", "60 minut a více"],
};

export default function PridatRecept() {
  const supabase = createClient();
  const router = useRouter();

  /* ===== Základ receptu ===== */
  const [nazev, setNazev] = useState("");
  const [kategorie, setKategorie] = useState("Snídaně");
  const [popis, setPopis] = useState("");

  /* ===== POVINNÉ suroviny ===== */
  const [suroviny, setSuroviny] = useState<Surovina[]>([]);
  const [novaSurovina, setNovaSurovina] = useState("");
  const [navrhy, setNavrhy] = useState<Navrh[]>([]);

  /* ===== VOLITELNÉ suroviny (nepočítají se do součtů) ===== */
  const [volitelne, setVolitelne] = useState<Surovina[]>([]);
  const [novaVolitelna, setNovaVolitelna] = useState("");
  const [navrhyVolitelne, setNavrhyVolitelne] = useState<Navrh[]>([]);

  /* ===== Moje/veřejné suroviny z DB ===== */
  const [dbSuroviny, setDbSuroviny] = useState<Ingredient[]>([]);
  const [loadingIngred, setLoadingIngred] = useState(true);

  /* ===== Štítky (skupiny + výběr) ===== */
  const [stitky, setStitky] = useState<string[]>([]);
  const [defStitky, setDefStitky] = useState<Record<TagGroupKey, string[]>>(DEFAULT_TAGS);
  const [novyTagText, setNovyTagText] = useState<Record<TagGroupKey, string>>({
    Tagy: "", Kuchyně: "", Období: "", Ingredience: "", "Doba přípravy": ""
  });

  /* ===== Foto ===== */
  const [foto, setFoto] = useState<string>("");

  /* ===== Uživatelský stav / ukládání ===== */
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ===== Načti session + ingredience z DB ===== */
  useEffect(() => {
    let mounted = true;
    (async () => {
      // session
      const { data: sess } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(sess.session?.user?.id ?? null);

      // ingredience (RLS: veřejné + vlastní)
      setLoadingIngred(true);
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .order("name", { ascending: true });

      if (!mounted) return;
      if (error) {
        console.error(error);
        setDbSuroviny([]);
      } else {
        // sloučení duplicit (preferuj záznam s vendor před bez vendor)
        const map = new Map<string, Ingredient>();
        for (const it of (data || []) as Ingredient[]) {
          const key = it.name.trim().toLowerCase();
          const existing = map.get(key);
          if (!existing) map.set(key, it);
          else {
            const pick =
              existing.vendor && !it.vendor
                ? existing
                : !existing.vendor && it.vendor
                ? it
                : it; // při rovnosti ber poslední
            map.set(key, pick);
          }
        }
        setDbSuroviny(Array.from(map.values()));
      }
      setLoadingIngred(false);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  /* ===== Definice štítků z localStorage ===== */
  useEffect(() => {
    try {
      const uloz = JSON.parse(localStorage.getItem("definiceStitku") || "null");
      if (uloz && typeof uloz === "object") {
        setDefStitky((prev) => {
          const merged = { ...prev };
          (Object.keys(prev) as TagGroupKey[]).forEach((g) => {
            const arr = Array.isArray(uloz[g]) ? uloz[g] : [];
            merged[g] = Array.from(new Set([...(prev[g] || []), ...arr]));
          });
          return merged;
        });
      }
    } catch {}
  }, []);

  /* ===== Autocomplete (jen z DB ingrediencí) ===== */
  useEffect(() => {
    const q = novaSurovina.trim().toLowerCase();
    if (!q) return setNavrhy([]);
    const res: Navrh[] = dbSuroviny
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.vendor || "").toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((m) => ({
        name: m.name,
        vendor: m.vendor,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
      }));
    setNavrhy(res);
  }, [novaSurovina, dbSuroviny]);

  useEffect(() => {
    const q = novaVolitelna.trim().toLowerCase();
    if (!q) return setNavrhyVolitelne([]);
    const res: Navrh[] = dbSuroviny
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.vendor || "").toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((m) => ({
        name: m.name,
        vendor: m.vendor,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
      }));
    setNavrhyVolitelne(res);
  }, [novaVolitelna, dbSuroviny]);

  /* ===== Helpery surovin ===== */
  function pridatSurovinu(s: Navrh) {
    setSuroviny((prev) => [...prev, { ...s, mnozstvi: 100, jednotka: "g" }]);
    setNovaSurovina("");
    setNavrhy([]);
  }
  function pridatVolitelnou(s: Navrh) {
    setVolitelne((prev) => [...prev, { ...s, mnozstvi: 100, jednotka: "g" }]);
    setNovaVolitelna("");
    setNavrhyVolitelne([]);
  }
  function upravitSurovinu(list: "povinne" | "volitelne", index: number, field: "mnozstvi" | "jednotka", value: string | number) {
    if (list === "povinne") {
      setSuroviny((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
    } else {
      setVolitelne((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
    }
  }
  function odstranitSurovinu(list: "povinne" | "volitelne", index: number) {
    if (list === "povinne") setSuroviny((prev) => prev.filter((_, i) => i !== index));
    else setVolitelne((prev) => prev.filter((_, i) => i !== index));
  }
  function prepocitatMakra(s: Surovina): Makra & { kcal: number } {
    let protein = s.protein, fat = s.fat, carbs = s.carbs;
    if (s.jednotka.toLowerCase() === "g" || s.jednotka.toLowerCase() === "ml") {
      protein = (protein * s.mnozstvi) / 100;
      fat = (fat * s.mnozstvi) / 100;
      carbs = (carbs * s.mnozstvi) / 100;
    }
    const kcal = protein * 4 + carbs * 4 + fat * 9;
    return { protein, fat, carbs, kcal };
  }

  /* ===== Foto ===== */
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFoto(String(reader.result));
    reader.readAsDataURL(file);
  }

  /* ===== Součet jen za POVINNÉ suroviny ===== */
  const total = useMemo(
    () =>
      suroviny.reduce(
        (acc, s) => {
          const m = prepocitatMakra(s);
          return { protein: acc.protein + m.protein, fat: acc.fat + m.fat, carbs: acc.carbs + m.carbs, kcal: acc.kcal + m.kcal };
        },
        { protein: 0, fat: 0, carbs: 0, kcal: 0 }
      ),
    [suroviny]
  );

  /* ===== Štítky ===== */
  function toggleTag(tag: string) {
    setStitky((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));
  }
  function addCustomTag(group: TagGroupKey) {
    const val = (novyTagText[group] || "").trim();
    if (!val) return;
    setDefStitky((prev) => {
      const next = { ...prev, [group]: Array.from(new Set([...(prev[group] || []), val])) };
      localStorage.setItem("definiceStitku", JSON.stringify(next));
      return next;
    });
    setNovyTagText((p) => ({ ...p, [group]: "" }));
    setStitky((p) => (p.includes(val) ? p : [...p, val]));
  }

  /* ===== Uložení do Supabase (recipes) ===== */
  async function ulozit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!userId) {
      setError("Pro uložení receptu se prosím přihlas.");
      return;
    }
    if (!nazev.trim()) {
      setError("Zadej název receptu.");
      return;
    }
    if (suroviny.length === 0) {
      setError("Přidej alespoň jednu surovinu.");
      return;
    }

    // serializace surovin: povinné i volitelné (ty volitelné jen jako text, bez započtení do makro-součtů)
    const povinneSuroviny = suroviny.map(
      (s) => `${s.mnozstvi} ${s.jednotka} ${s.name}${s.vendor ? ` (${s.vendor})` : ""}`
    );
    const povinnaMakra = suroviny.map((s) => {
      const m = prepocitatMakra(s);
      return { protein: m.protein, fat: m.fat, carbs: m.carbs, kcal: m.kcal };
    });

    const volitelneSuroviny = volitelne.map(
      (s) => `(volitelné) ${s.mnozstvi} ${s.jednotka} ${s.name}${s.vendor ? ` (${s.vendor})` : ""}`
    );

    const surovinyVse = [...povinneSuroviny, ...volitelneSuroviny];

    setSaving(true);
    const { error } = await supabase
      .from("recipes")
      .insert({
        nazev: nazev.trim(),
        kategorie: kategorie.trim(),
        popis: popis.trim() || null,
        suroviny: surovinyVse, // JSONB text[]
        makra: povinnaMakra,   // JSONB
        foto: foto || null,
        stitky,                // JSONB text[]
        // owner_id doplní trigger / default
      });

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    alert("Recept uložen!");
    router.push("/");
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Přidat recept</h1>

      {/* Info pro nepřihlášené */}
      {!userId && (
        <div className="card p-4 mb-4 text-sm">
          Pro ukládání receptů se prosím <Link className="underline" href="/auth">přihlas</Link>.
          Veškeré recepty jsou soukromé a vidíš jen svoje.
        </div>
      )}

      <form onSubmit={ulozit} className="space-y-4 card p-4">
        {error && <div className="text-sm text-red-600">{error}</div>}

        {/* === Základní info === */}
        <input
          className="w-full border rounded-xl px-3 py-2"
          placeholder="Název receptu"
          value={nazev}
          onChange={(e) => setNazev(e.target.value)}
          required
        />

        <div className="flex gap-2">
          <select
            className="border rounded-xl px-3 py-2"
            value={kategorie}
            onChange={(e) => setKategorie(e.target.value)}
          >
            {["Snídaně", "Oběd", "Večeře", "Svačina", "Dezerty"].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input
            className="flex-1 border rounded-xl px-3 py-2"
            placeholder="Nebo napiš novou kategorii"
            onChange={(e) => setKategorie(e.target.value || "Snídaně")}
          />
        </div>

        <textarea
          className="w-full border rounded-xl px-3 py-2"
          placeholder="Popis (postup)"
          rows={4}
          value={popis}
          onChange={(e) => setPopis(e.target.value)}
        />

        {/* === POVINNÉ suroviny === */}
        <section>
          <label className="font-semibold">Suroviny</label>
          <div className="relative mt-1">
            <div className="flex items-center gap-2">
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder='Přidej surovinu z "Moje suroviny"…'
                value={novaSurovina}
                onChange={(e) => setNovaSurovina(e.target.value)}
                disabled={loadingIngred}
              />
              <Link href="/suroviny" className="pill">🧺 Moje suroviny</Link>
            </div>

            {novaSurovina.trim() && navrhy.length === 0 && !loadingIngred && (
              <div className="mt-1 text-xs text-gray-500">
                Nic nenalezeno. Přidej položku v <Link className="underline" href="/suroviny">Moje suroviny</Link>.
              </div>
            )}

            {navrhy.length > 0 && (
              <ul className="absolute z-10 bg-white border w-full max-h-60 overflow-auto rounded-xl shadow">
                {navrhy.map((n, i) => (
                  <li
                    key={`${n.name}-${n.vendor || ""}-${i}`}
                    onClick={() => pridatSurovinu(n)}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span>
                        {n.name} {n.vendor && <span className="text-xs text-gray-500">({n.vendor})</span>}
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

          {suroviny.length > 0 && (
            <ul className="mt-3 space-y-2">
              {suroviny.map((s, i) => {
                const m = prepocitatMakra(s);
                return (
                  <li key={i} className="flex flex-col gap-1 border p-2 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {s.name} {s.vendor && <span className="text-xs text-gray-500">({s.vendor})</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => odstranitSurovinu("povinne", i)}
                        className="text-red-600 hover:text-red-700"
                      >
                        ✖
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="number"
                        min="0"
                        className="w-24 border rounded-xl px-2 py-1"
                        value={s.mnozstvi}
                        onChange={(e) => upravitSurovinu("povinne", i, "mnozstvi", Number(e.target.value))}
                      />
                      <select
                        className="border rounded-xl px-2 py-1"
                        value={s.jednotka}
                        onChange={(e) => upravitSurovinu("povinne", i, "jednotka", e.target.value)}
                      >
                        <option value="g">g</option>
                        <option value="ml">ml</option>
                        <option value="ks">ks</option>
                      </select>
                      <span className="text-sm text-gray-600">
                        P: {m.protein.toFixed(1)}g | T: {m.fat.toFixed(1)}g | S: {m.carbs.toFixed(1)}g | {m.kcal.toFixed(0)} kcal
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* === ŠTÍTKY – skupiny + vlastní pod-štítky === */}
        <section className="card p-4">
          <h3 className="text-lg font-semibold mb-2">Štítky</h3>
          {(Object.keys(defStitky) as TagGroupKey[]).map((group) => (
            <div key={group} className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">{group}</h4>
                <span className="text-xs text-gray-500">
                  {stitky.filter((t) => defStitky[group]?.includes(t)).length} vybráno
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {(defStitky[group] || []).map((t) => {
                  const active = stitky.includes(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggleTag(t)}
                      className={`pill !rounded-xl !text-emerald-900 ${
                        active ? "ring-2 ring-emerald-500/40 !bg-white/90" : "!bg-white/60"
                      }`}
                      title={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 border rounded-xl px-3 py-2"
                  placeholder={`Přidat nový do „${group}“…`}
                  value={novyTagText[group]}
                  onChange={(e) => setNovyTagText((p) => ({ ...p, [group]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomTag(group);
                    }
                  }}
                />
                <button type="button" onClick={() => addCustomTag(group)} className="btn-primary">
                  Přidat
                </button>
              </div>
            </div>
          ))}

          {stitky.length > 0 && (
            <div className="mt-4 text-xs text-gray-600">
              Vybráno: {stitky.join(", ")}
              <button type="button" onClick={() => setStitky([])} className="ml-2 underline text-emerald-700">
                vyčistit
              </button>
            </div>
          )}
        </section>

        {/* === VOLITELNÉ suroviny === */}
        <section className="pt-2 border-t">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Volitelné suroviny</h3>
            <span className="text-xs text-gray-500">(nezapočítávají se do celkových makro hodnot)</span>
          </div>

          <div className="relative mt-2">
            <div className="flex items-center gap-2">
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder='Přidej volitelnou surovinu z "Moje suroviny"…'
                value={novaVolitelna}
                onChange={(e) => setNovaVolitelna(e.target.value)}
                disabled={loadingIngred}
              />
              <Link href="/suroviny" className="pill">🧺 Moje suroviny</Link>
            </div>

            {novaVolitelna.trim() && navrhyVolitelne.length === 0 && !loadingIngred && (
              <div className="mt-1 text-xs text-gray-500">
                Nic nenalezeno. Přidej položku v <Link className="underline" href="/suroviny">Moje suroviny</Link>.
              </div>
            )}

            {navrhyVolitelne.length > 0 && (
              <ul className="absolute z-10 bg-white border w-full max-h-60 overflow-auto rounded-xl shadow">
                {navrhyVolitelne.map((n, i) => (
                  <li
                    key={`${n.name}-${n.vendor || ""}-opt-${i}`}
                    onClick={() => pridatVolitelnou(n)}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span>
                        {n.name} {n.vendor && <span className="text-xs text-gray-500">({n.vendor})</span>}
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

          {volitelne.length > 0 && (
            <ul className="mt-3 space-y-2">
              {volitelne.map((s, i) => {
                const m = prepocitatMakra(s);
                return (
                  <li key={i} className="flex flex-col gap-1 border p-2 rounded-xl bg-gray-50">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {s.name} {s.vendor && <span className="text-xs text-gray-500">({s.vendor})</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => odstranitSurovinu("volitelne", i)}
                        className="text-red-600 hover:text-red-700"
                      >
                        ✖
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="number"
                        min="0"
                        className="w-24 border rounded-xl px-2 py-1"
                        value={s.mnozstvi}
                        onChange={(e) => upravitSurovinu("volitelne", i, "mnozstvi", Number(e.target.value))}
                      />
                      <select
                        className="border rounded-xl px-2 py-1"
                        value={s.jednotka}
                        onChange={(e) => upravitSurovinu("volitelne", i, "jednotka", e.target.value)}
                      >
                        <option value="g">g</option>
                        <option value="ml">ml</option>
                        <option value="ks">ks</option>
                      </select>
                      <span className="text-sm text-gray-600">
                        (nezapočítává se) • P: {m.protein.toFixed(1)}g | T: {m.fat.toFixed(1)}g | S: {m.carbs.toFixed(1)}g | {m.kcal.toFixed(0)} kcal
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* === Foto === */}
        <label className="block">
          <span className="text-sm text-gray-600">Fotka receptu</span>
          <input type="file" accept="image/*" onChange={onPickFile} className="mt-1 block w-full" />
        </label>
        {foto && <img src={foto} alt="Náhled" className="mt-2 max-h-40 rounded-xl border" />}

        {/* === Souhrn (bez volitelných) === */}
        {suroviny.length > 0 && (
          <div className="mt-2 p-3 border-t text-sm bg-gray-50 rounded-xl font-medium">
            Celkem (bez volitelných): P: {total.protein.toFixed(1)} g · T: {total.fat.toFixed(1)} g ·
            {" "}S: {total.carbs.toFixed(1)} g · {total.kcal.toFixed(0)} kcal
          </div>
        )}

        <button className="btn-primary disabled:opacity-60" disabled={saving || !userId}>
          {saving ? "Ukládám…" : "Uložit"}
        </button>
      </form>
    </main>
  );
}
