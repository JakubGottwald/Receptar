"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

/* ==== Typy ==== */
type Makra = { protein: number; fat: number; carbs: number; kcal?: number };

type Recept = {
  id: string;                 // UUID z DB
  owner_id: string;
  created_at: string;
  updated_at: string;
  nazev: string;
  kategorie: string;
  popis: string | null;
  suroviny: string[];
  makra: Makra[];
  foto: string | null;
  stitky: string[];           // flat list
};

type TagGroupKey = "Tagy" | "Kuchyně" | "Období" | "Ingredience" | "Doba přípravy";
const TAG_GROUPS_ORDER: TagGroupKey[] = ["Tagy", "Kuchyně", "Období", "Ingredience", "Doba přípravy"];

const DEFAULT_TAGS: Record<TagGroupKey, string[]> = {
  Tagy: ["S videem", "Bez laktózy", "Bez lepku", "Keto", "Low carb", "Vegan", "Vegetarian"],
  Kuchyně: ["Americká kuchyně", "Asijská kuchyně", "Italská kuchyně", "Mexická kuchyně", "Řecká kuchyně"],
  Období: ["Jaro", "Léto", "Podzim", "Zima", "Silvestr", "Vánoce", "Velikonoce"],
  Ingredience: ["Ovesné vločky", "Banán", "Bílý jogurt", "Avokádo", "Arašídové máslo"],
  "Doba přípravy": ["Do 15 minut", "Do 30 minut", "Do 60 minut", "60 minut a více"],
};

type Razeni =
  | "nejnovejsi"
  | "nejstarsi"
  | "nazevAZ"
  | "nazevZA"
  | "kcalMax"
  | "kcalMin"
  | "proteinMax"
  | "proteinMin";

export default function Home() {
  const supabase = createClient();

  const [recepty, setRecepty] = useState<Recept[]>([]);
  const [vybraneStitky, setVybraneStitky] = useState<string[]>([]);
  const [razeni, setRazeni] = useState<Razeni>("nejnovejsi");
  const [defStitky, setDefStitky] = useState<Record<TagGroupKey, string[]>>(DEFAULT_TAGS);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const aktivniKategorie = searchParams.get("kategorie");
  const aktivniHledani = (searchParams.get("hledat") || "").toLowerCase();

  // Načti session + recepty z DB
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      // session -> jen kvůli info; RLS zajistí, že uvidíš jen svoje
      const { data: sess } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(sess.session?.user?.id ?? null);

      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .order("created_at", { ascending: false });

      if (!mounted) return;
      if (error) {
        console.error(error);
        setRecepty([]);
      } else {
        // přetypuj/normalizuj jsonb -> TS
        const rows = (data || []).map((r: any) => ({
          ...r,
          popis: r.popis ?? null,
          foto: r.foto ?? null,
          stitky: Array.isArray(r.stitky) ? r.stitky : [],
          suroviny: Array.isArray(r.suroviny) ? r.suroviny : [],
          makra: Array.isArray(r.makra) ? r.makra : [],
        })) as Recept[];
        setRecepty(rows);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  // Definice štítků z localStorage (uživatelské rozšíření)
  useEffect(() => {
    try {
      const ulozene = JSON.parse(localStorage.getItem("definiceStitku") || "null");
      if (ulozene && typeof ulozene === "object") {
        setDefStitky((prev) => {
          const merged = { ...prev };
          for (const g of TAG_GROUPS_ORDER) {
            const arr = Array.isArray(ulozene[g]) ? ulozene[g] : [];
            merged[g] = Array.from(new Set([...(prev[g] || []), ...arr]));
          }
          return merged;
        });
      }
    } catch {}
  }, []);

  function smazat(id: string) {
    if (!confirm("Opravdu smazat tento recept?")) return;
    (async () => {
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) return alert(error.message);
      setRecepty((prev) => prev.filter((r) => r.id !== id));
    })();
  }

  function toggleStitek(tag: string) {
    setVybraneStitky((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));
  }

  // map tag -> count
  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recepty) (r.stitky || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1));
    return m;
  }, [recepty]);

  // Do jaké skupiny patří tag
  function resolveGroupForTag(tag: string): TagGroupKey {
    for (const g of TAG_GROUPS_ORDER) if (defStitky[g]?.includes(tag)) return g;
    return "Tagy";
  }

  // Seskup štítky
  const tagsByGroup: Record<TagGroupKey, string[]> = useMemo(() => {
    const out: Record<TagGroupKey, string[]> = TAG_GROUPS_ORDER.reduce(
      (acc, g) => ({ ...acc, [g]: [...(defStitky[g] || [])] }),
      {} as Record<TagGroupKey, string[]>
    );
    for (const r of recepty) {
      for (const t of r.stitky || []) {
        const g = resolveGroupForTag(t);
        if (!out[g].includes(t)) out[g].push(t);
      }
    }
    for (const g of TAG_GROUPS_ORDER) out[g].sort((a, b) => a.localeCompare(b, "cs"));
    return out;
  }, [recepty, defStitky]);

  // Filtry
  const filtrovaneRecepty = useMemo(() => {
    return recepty.filter((r) => {
      const kategorieOk = aktivniKategorie
        ? r.kategorie?.toLowerCase() === aktivniKategorie.toLowerCase()
        : true;
      const hledaniOk = aktivniHledani ? r.nazev?.toLowerCase().includes(aktivniHledani) : true;
      const tagyOk =
        vybraneStitky.length === 0
          ? true
          : vybraneStitky.every((t) => (r.stitky || []).includes(t));
      return kategorieOk && hledaniOk && tagyOk;
    });
  }, [recepty, aktivniKategorie, aktivniHledani, vybraneStitky]);

  // Součty pro řazení/karty
  function totals(r: Recept) {
    const protein = r.makra?.reduce((a, b) => a + (b.protein || 0), 0) ?? 0;
    const kcal =
      r.makra?.reduce(
        (a, b) =>
          a +
          (b.kcal !== undefined
            ? b.kcal
            : (b.protein || 0) * 4 + (b.carbs || 0) * 4 + (b.fat || 0) * 9),
        0
      ) ?? 0;
    const fat = r.makra?.reduce((a, b) => a + (b.fat || 0), 0) ?? 0;
    const carbs = r.makra?.reduce((a, b) => a + (b.carbs || 0), 0) ?? 0;
    return { protein, kcal, fat, carbs };
  }

  // Řazení (nejnovější podle created_at)
  const serazeneRecepty = useMemo(() => {
    const arr = [...filtrovaneRecepty];
    arr.sort((a, b) => {
      const ta = totals(a);
      const tb = totals(b);
      switch (razeni) {
        case "nejnovejsi":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "nejstarsi":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "nazevAZ":
          return a.nazev.localeCompare(b.nazev, "cs");
        case "nazevZA":
          return b.nazev.localeCompare(a.nazev, "cs");
        case "kcalMax":
          return tb.kcal - ta.kcal;
        case "kcalMin":
          return ta.kcal - tb.kcal;
        case "proteinMax":
          return tb.protein - ta.protein;
        case "proteinMin":
          return ta.protein - tb.protein;
        default:
          return 0;
      }
    });
    return arr;
  }, [filtrovaneRecepty, razeni]);

  return (
    <main className="p-6 sm:p-8 max-w-6xl mx-auto">
      {/* hlavička */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {aktivniKategorie ? `Recepty – ${aktivniKategorie}` : "Naše recepty"}
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Řazení</span>
          <select
            className="rounded-xl border px-3 py-2 bg-white/80 backdrop-blur-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            value={razeni}
            onChange={(e) => setRazeni(e.target.value as Razeni)}
          >
            <option value="nejnovejsi">Nejnovější</option>
            <option value="nejstarsi">Nejstarší</option>
            <option value="nazevAZ">Název A–Z</option>
            <option value="nazevZA">Název Z–A</option>
            <option value="kcalMax">Nejvíc kcal</option>
            <option value="kcalMin">Nejmíň kcal</option>
            <option value="proteinMax">Nejvíc bílkovin</option>
            <option value="proteinMin">Nejmíň bílkovin</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[270px_1fr] gap-6">
        {/* Sidebar filtry */}
        <aside className="card h-max sticky top-20">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Filtry</h2>
              {vybraneStitky.length > 0 && (
                <button
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={() => setVybraneStitky([])}
                >
                  Vyčistit
                </button>
              )}
            </div>

            {TAG_GROUPS_ORDER.map((group) => {
              const tags = tagsByGroup[group];
              if (!tags?.length) return null;
              return (
                <div key={group} className="mt-4">
                  <h3 className="font-medium text-sm mb-2">{group}</h3>
                  <ul className="space-y-2">
                    {tags.map((tag) => {
                      const active = vybraneStitky.includes(tag);
                      const count = countMap.get(tag) || 0;
                      return (
                        <li key={tag}>
                          <button
                            onClick={() => toggleStitek(tag)}
                            className={`pill w-full justify-between !rounded-xl !text-emerald-900
                              ${active ? "ring-2 ring-emerald-500/40 !bg-white/90" : "!bg-white/60"}`}
                          >
                            <span className="truncate">{tag}</span>
                            <span className="text-xs opacity-70">({count})</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Seznam receptů */}
        <section>
          {loading ? (
            <div className="card p-8 text-center text-gray-600">Načítám…</div>
          ) : serazeneRecepty.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-6xl mb-2">🍽️</div>
              <p className="text-gray-600">
                {userId
                  ? "Zatím žádné recepty. Přidej první! 🍳"
                  : "Přihlas se, aby se ti zobrazily tvoje recepty."}
              </p>
              {!userId && (
                <div className="mt-3">
                  <Link href="/auth" className="btn-primary">Přihlásit se</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {serazeneRecepty.map((r) => {
                const { protein, fat, carbs, kcal } = totals(r);
                return (
                  <Link key={r.id} href={`/recept/${r.id}`} className="group">
                    <article className="card overflow-hidden will-change-transform transition-transform duration-200 group-hover:-translate-y-1">
                      {/* Obrázek */}
                      {r.foto ? (
                        <div className="relative">
                          <img
                            src={r.foto}
                            alt={r.nazev}
                            loading="lazy"
                            className="w-full h-44 object-cover transition duration-200 group-hover:scale-[1.02]"
                          />
                          <span className="absolute left-3 top-3 bg-black/45 text-white text-xs px-2 py-1 rounded-lg backdrop-blur-sm">
                            {r.kategorie}
                          </span>
                        </div>
                      ) : (
                        <div className="h-44 bg-gradient-to-br from-emerald-100 to-white flex items-center justify-center">
                          <span className="text-emerald-700/70">Bez fotky</span>
                          <span className="sr-only">{r.kategorie}</span>
                        </div>
                      )}

                      {/* Text */}
                      <div className="p-4">
                        <div className="flex items-start gap-2">
                          <h2 className="text-lg font-semibold leading-snug flex-1">{r.nazev}</h2>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              smazat(r.id);
                            }}
                            className="rounded-lg px-2 py-1 text-xs bg-red-600 text-white hover:bg-red-700 active:scale-95 transition"
                            aria-label="Smazat recept"
                            title="Smazat recept"
                          >
                            🗑
                          </button>
                        </div>

                        {/* Štítky náhled */}
                        {r.stitky && r.stitky.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {r.stitky.slice(0, 5).map((t, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"
                              >
                                {t}
                              </span>
                            ))}
                            {r.stitky.length > 5 && (
                              <span className="text-xs text-gray-500">+{r.stitky.length - 5}</span>
                            )}
                          </div>
                        )}

                        {/* Popis */}
                        {r.popis && <p className="mt-2 text-gray-700 line-clamp-3">{r.popis}</p>}

                        {/* Makra */}
                        {r.makra?.length ? (
                          <div className="mt-3 text-sm bg-white/70 rounded-xl border border-white/50 p-3">
                            <div className="font-medium mb-1">Makra (celkem)</div>
                            <div className="grid grid-cols-2 gap-2 text-gray-700">
                              <div>⚡ {Math.round(kcal)} kcal</div>
                              <div>🥚 {protein.toFixed(1)} g bílkovin</div>
                              <div>🥑 {fat.toFixed(1)} g tuků</div>
                              <div>🌾 {carbs.toFixed(1)} g sacharidů</div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
