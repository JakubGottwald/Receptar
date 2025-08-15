"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Makra = { protein: number; fat: number; carbs: number; kcal?: number };
type Recept = {
  id: number;
  nazev: string;
  kategorie: string;
  popis: string;
  suroviny?: string[];
  makra?: Makra[];
  foto?: string;
  stitky?: string[];
};

type Navrh = { name: string; prodejce?: string; protein: number; fat: number; carbs: number };
type Surovina = Navrh & { mnozstvi: number; jednotka: "g" | "ml" | "ks" };
type CustomSurovina = { name: string; prodejce?: string; protein: number; carbs: number; fat: number };

/** Parsuje řádek typu:
 * "100 g Jogurt bílý (Lidl)" nebo "2 ks Vejce"
 * Vrací množství, jednotku, název a volitelně prodejce v závorkách na konci.
 */
function parseRadek(radek: string) {
  const m = radek?.match?.(/^(\d+)\s*(g|ml|ks)\s+(.+?)(?:\s*\(([^)]+)\))?$/i);
  if (m) {
    return {
      mnozstvi: Number(m[1]),
      jednotka: m[2].toLowerCase() as "g" | "ml" | "ks",
      name: m[3],
      prodejce: m[4] || undefined,
    };
  }
  return null;
}

/** Přepočet maker (per-100g/ml) na zadané množství; u "ks" ponechá hodnoty beze změny */
function prepocitatMakra(s: Surovina): Required<Makra> {
  let p = s.protein, f = s.fat, c = s.carbs;
  if (s.jednotka === "g" || s.jednotka === "ml") {
    p = (p * s.mnozstvi) / 100;
    f = (f * s.mnozstvi) / 100;
    c = (c * s.mnozstvi) / 100;
  }
  const kcal = p * 4 + c * 4 + f * 9;
  return { protein: p, fat: f, carbs: c, kcal };
}

export default function DetailReceptu() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [recept, setRecept] = useState<Recept | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // textové stavy
  const [nazev, setNazev] = useState("");
  const [kategorie, setKategorie] = useState("");
  const [popis, setPopis] = useState("");

  // editor surovin
  const [surovinyEdit, setSurovinyEdit] = useState<Surovina[]>([]);
  const [novaSurovina, setNovaSurovina] = useState("");
  const [navrhy, setNavrhy] = useState<Navrh[]>([]);
  const [mojeSuroviny, setMojeSuroviny] = useState<CustomSurovina[]>([]);

  // Načtení receptu + příprava editoru
  useEffect(() => {
    const list: Recept[] = JSON.parse(localStorage.getItem("recepty") || "[]");
    const found = list.find((r) => String(r.id) === String(id)) || null;
    setRecept(found);

    if (found) {
      setNazev(found.nazev);
      setKategorie(found.kategorie);
      setPopis(found.popis);

      const prepared: Surovina[] =
        (found.suroviny || []).map((radek, i) => {
          const parsed = parseRadek(radek);
          const m = found.makra?.[i];

          let mnozstvi = 100 as number;
          let jednotka: "g" | "ml" | "ks" = "g";
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
    }

    // načti „Moje suroviny“
    try {
      const ulozene = JSON.parse(localStorage.getItem("mojeSuroviny") || "[]");
      setMojeSuroviny(Array.isArray(ulozene) ? ulozene : []);
    } catch {
      setMojeSuroviny([]);
    }

    setLoaded(true);
  }, [id]);

  // Autocomplete pouze z „Moje suroviny“
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
          (m.prodejce || "").toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((m) => ({
        name: m.name,
        prodejce: m.prodejce,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
      }));
    setNavrhy(vysledky);
  }, [novaSurovina, mojeSuroviny]);

  // Akce surovin v editoru
  function pridatSurovinu(n: Navrh) {
    setSurovinyEdit((prev) => [
      ...prev,
      { ...n, mnozstvi: 100, jednotka: "g" },
    ]);
    setNovaSurovina("");
    setNavrhy([]);
  }
  function odstranitSurovinu(index: number) {
    setSurovinyEdit((prev) => prev.filter((_, i) => i !== index));
  }
  function upravitSurovinu(
    index: number,
    field: "mnozstvi" | "jednotka",
    value: number | "g" | "ml" | "ks"
  ) {
    setSurovinyEdit((prev) =>
      prev.map((it, i) => (i === index ? { ...it, [field]: value } : it))
    );
  }

  function odstranitRecept() {
    if (!confirm("Opravdu chceš tento recept smazat?")) return;
    const list: Recept[] = JSON.parse(localStorage.getItem("recepty") || "[]");
    const nove = list.filter((r) => String(r.id) !== String(id));
    localStorage.setItem("recepty", JSON.stringify(nove));
    router.push("/");
  }

  function ulozitUpravy(e: React.FormEvent) {
    e.preventDefault();
    if (!recept) return;

    const noveSuroviny = surovinyEdit.map(
      (s) => `${s.mnozstvi} ${s.jednotka} ${s.name}${s.prodejce ? ` (${s.prodejce})` : ""}`
    );
    const noveMakra = surovinyEdit.map((s) => prepocitatMakra(s));

    const list: Recept[] = JSON.parse(localStorage.getItem("recepty") || "[]");
    const nove = list.map((r) =>
      String(r.id) === String(id)
        ? {
            ...r,
            nazev,
            kategorie,
            popis,
            suroviny: noveSuroviny,
            makra: noveMakra,
            // zachováme případné foto/štítky
            foto: r.foto,
            stitky: r.stitky,
          }
        : r
    );
    localStorage.setItem("recepty", JSON.stringify(nove));
    setEditMode(false);
    const updated = nove.find((r) => String(r.id) === String(id)) || null;
    setRecept(updated);
    router.refresh();
  }

  function duplikovatRecept() {
    if (!recept) return;
    const list: Recept[] = JSON.parse(localStorage.getItem("recepty") || "[]");
    const kopie: Recept = {
      ...recept,
      id: Date.now(),
      nazev: recept.nazev + " (kopie)",
    };
    const nove = [kopie, ...list];
    localStorage.setItem("recepty", JSON.stringify(nove));
    router.push(`/recept/${kopie.id}`);
  }

  const calcKcal = (m: Makra) =>
    m.kcal !== undefined ? m.kcal : (m.protein || 0) * 4 + (m.carbs || 0) * 4 + (m.fat || 0) * 9;

  if (!loaded) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <p>Načítám…</p>
      </main>
    );
  }

  if (!recept) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <p>Recept nenalezen.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-3 px-3 py-2 rounded bg-gray-200"
        >
          ← Zpět
        </button>
      </main>
    );
  }

  const total = (k: keyof Makra) =>
    (recept.makra?.reduce((a, b) => a + (b[k] || 0), 0) || 0).toFixed(1);
  const totalKcal = recept.makra
    ? recept.makra.reduce((a, b) => a + calcKcal(b), 0).toFixed(0)
    : "0";

  // Součty v editoru
  const totalEdit = surovinyEdit.reduce(
    (acc, s) => {
      const m = prepocitatMakra(s);
      return {
        protein: acc.protein + m.protein,
        fat: acc.fat + m.fat,
        carbs: acc.carbs + m.carbs,
        kcal: acc.kcal + m.kcal,
      };
    },
    { protein: 0, fat: 0, carbs: 0, kcal: 0 }
  );

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <button
        onClick={() => router.back()}
        className="px-3 py-2 rounded bg-gray-200"
      >
        ← Zpět
      </button>

      {!editMode ? (
        <>
          {recept.foto && (
            <img
              src={recept.foto}
              alt={recept.nazev}
              className="w-full max-h-72 object-cover rounded-lg"
            />
          )}
          <h1 className="text-3xl font-bold mt-2">{recept.nazev}</h1>
          <p className="text-sm text-gray-500">{recept.kategorie}</p>

          {recept.stitky && recept.stitky.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {recept.stitky.map((t, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {recept.makra && recept.makra.length > 0 && (
            <div className="mt-4 bg-green-50 border border-green-200 p-4 rounded">
              <strong>Makra (součet):</strong>
              <div>Bílkoviny: {total("protein")} g</div>
              <div>Tuky: {total("fat")} g</div>
              <div>Sacharidy: {total("carbs")} g</div>
              <div>Energetická hodnota: {totalKcal} kcal</div>
            </div>
          )}

          {recept.suroviny?.length ? (
            <section className="mt-6">
              <h2 className="text-xl font-semibold">Suroviny</h2>
              <ul className="list-disc pl-5 mt-2">
                {recept.suroviny.map((s, i) => {
                  const m = recept.makra?.[i];
                  if (!m) return <li key={i}>{s}</li>;
                  return (
                    <li key={i}>
                      {s} – {m.protein.toFixed(1)} g bílkovin,{" "}
                      {m.fat.toFixed(1)} g tuků, {m.carbs.toFixed(1)} g
                      sacharidů, {calcKcal(m).toFixed(0)} kcal
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {recept.popis && (
            <section className="mt-6">
              <h2 className="text-xl font-semibold">Postup</h2>
              <p className="mt-2 whitespace-pre-line">{recept.popis}</p>
            </section>
          )}

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
        </>
      ) : (
        <form onSubmit={ulozitUpravy} className="space-y-4 bg-white p-4 rounded shadow">
          <h2 className="text-xl font-semibold">Upravit recept</h2>
          <input
            className="w-full border rounded px-3 py-2"
            value={nazev}
            onChange={(e) => setNazev(e.target.value)}
            placeholder="Název receptu"
          />
          <input
            className="w-full border rounded px-3 py-2"
            value={kategorie}
            onChange={(e) => setKategorie(e.target.value)}
            placeholder="Kategorie"
          />
          <textarea
            className="w-full border rounded px-3 py-2"
            rows={4}
            value={popis}
            onChange={(e) => setPopis(e.target.value)}
            placeholder="Postup"
          />

          {/* Input pro suroviny s autocomplete (pouze z „Moje suroviny“) */}
          <div className="relative">
            <div className="flex items-center gap-2">
              <input
                className="w-full border rounded px-3 py-2"
                placeholder="Přidej surovinu z „Moje suroviny“…"
                value={novaSurovina}
                onChange={(e) => setNovaSurovina(e.target.value)}
              />
              <Link
                href="/suroviny"
                className="whitespace-nowrap text-sm px-2 py-2 rounded border hover:bg-gray-50"
                title="Přejít na Moje suroviny"
              >
                + Moje suroviny
              </Link>
            </div>

            {novaSurovina.trim() && navrhy.length === 0 && (
              <div className="mt-1 text-xs text-gray-500">
                Nic nenalezeno. Přidej si položku v{" "}
                <Link href="/suroviny" className="underline">Moje suroviny</Link>.
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
                        onChange={(e) =>
                          upravitSurovinu(i, "mnozstvi", Number(e.target.value))
                        }
                      />
                      <select
                        className="border rounded px-2 py-1"
                        value={s.jednotka}
                        onChange={(e) =>
                          upravitSurovinu(i, "jednotka", e.target.value as "g" | "ml" | "ks")
                        }
                      >
                        <option value="g">g</option>
                        <option value="ml">ml</option>
                        <option value="ks">ks</option>
                      </select>
                      <span className="text-sm text-gray-600">
                        P: {m.protein.toFixed(1)}g | T: {m.fat.toFixed(1)}g | S:{" "}
                        {m.carbs.toFixed(1)}g | {m.kcal.toFixed(0)} kcal
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Součet v editoru */}
          {surovinyEdit.length > 0 && (
            <div className="mt-2 p-3 border-t text-sm bg-gray-50 rounded font-medium">
              Celkem: P: {totalEdit.protein.toFixed(1)}g | T:{" "}
              {totalEdit.fat.toFixed(1)}g | S: {totalEdit.carbs.toFixed(1)}g |{" "}
              {totalEdit.kcal.toFixed(0)} kcal
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              💾 Uložit
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
