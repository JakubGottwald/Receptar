"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";

type Ingredient = {
  id: string;
  owner_id: string | null;
  name: string;
  vendor: string | null;
  protein: number;
  carbs: number;
  fat: number;
};

function canon(s: string | null | undefined) {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
function hasVendor(i: Pick<Ingredient, "vendor">) {
  return canon(i.vendor).length > 0;
}
function keyByNameVendor(i: Pick<Ingredient, "name" | "vendor">) {
  return `${canon(i.name)}|${canon(i.vendor)}`;
}

export default function SurovinyPage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Ingredient[]>([]);
  const [error, setError] = useState<string | null>(null);

  // info počty z DB (ne po sloučení)
  const [publicCount, setPublicCount] = useState(0);
  const [ownCount, setOwnCount] = useState(0);

  // form
  const [form, setForm] = useState({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    (async () => {
      setLoading(true);
      setError(null);

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      setUserId(uid);

      await loadIngredients(uid);

      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
        const uid2 = session?.user?.id ?? null;
        setUserId(uid2);
        await loadIngredients(uid2);
      });
      unsub = () => sub.subscription.unsubscribe();

      setLoading(false);
    })();

    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadIngredients(uid: string | null) {
    setError(null);

    if (!uid) {
      // nepřihlášený: jen veřejné
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .is("owner_id", null);
      if (error) return setError(error.message);

      const pub = (data as Ingredient[]) ?? [];
      const merged = mergePreferringVendor(pub, []); // jen veřejné
      setList(sortByName(merged));
      setPublicCount(pub.length);
      setOwnCount(0);
      return;
    }

    // přihlášený: stáhneme oboje
    const [pubRes, ownRes] = await Promise.all([
      supabase.from("ingredients").select("*").is("owner_id", null),
      supabase.from("ingredients").select("*").eq("owner_id", uid),
    ]);
    if (pubRes.error) return setError(pubRes.error.message);
    if (ownRes.error) return setError(ownRes.error.message);

    const pub = (pubRes.data as Ingredient[]) ?? [];
    const own = (ownRes.data as Ingredient[]) ?? [];

    const merged = mergePreferringVendor(pub, own);
    setList(sortByName(merged));
    setPublicCount(pub.length);
    setOwnCount(own.length);
  }

  /** Sloučení:
   *  1) deduplikace podle (name+vendor), přičemž vlastní má přednost
   *  2) pro každý název name:
   *     - pokud existuje aspoň jeden záznam s vendor -> všechny vendor-prázdné téhož názvu zahodíme
   *     - jinak necháme max. jeden vendor-prázdný (přednost vlastní)
   */
  function mergePreferringVendor(publicRows: Ingredient[], ownRows: Ingredient[]) {
    const mergedByPair = new Map<string, Ingredient>();

    // pořadí: vlastní mají přednost
    const combined = [...ownRows, ...publicRows];

    // 1) deduplikace podle jméno+vendor
    for (const row of combined) {
      const key = keyByNameVendor(row);
      if (!mergedByPair.has(key)) mergedByPair.set(key, row);
    }

    const byNameHasVendor = new Map<string, boolean>();
    for (const row of mergedByPair.values()) {
      const n = canon(row.name);
      if (hasVendor(row)) byNameHasVendor.set(n, true);
    }

    const pickedByNameVendorless = new Map<string, Ingredient>();
    const final: Ingredient[] = [];

    for (const row of mergedByPair.values()) {
      const n = canon(row.name);
      if (hasVendor(row)) {
        // vždy nech vendor-PLNÉ (různí výrobci se ponechají jako samostatné položky)
        final.push(row);
      } else {
        // vendor prázdný — přidej jen pokud NEexistuje žádný s výrobcem,
        // a zároveň max. jeden vendorless na název (přednost vlastní, proto combined pořadí)
        if (!byNameHasVendor.get(n) && !pickedByNameVendorless.has(n)) {
          pickedByNameVendorless.set(n, row);
          final.push(row);
        }
      }
    }

    return final;
  }

  function sortByName(arr: Ingredient[]) {
    return [...arr].sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const protein = parseFloat(form.protein);
    const carbs = parseFloat(form.carbs);
    const fat = parseFloat(form.fat);

    if (!form.name.trim() || Number.isNaN(protein) || Number.isNaN(carbs) || Number.isNaN(fat)) {
      setError("Vyplň název a čísla pro B/S/T.");
      return;
    }
    if (!userId) {
      setError("Pro ukládání je potřeba se přihlásit.");
      return;
    }

    if (editId) {
      const { error } = await supabase
        .from("ingredients")
        .update({
          name: form.name.trim(),
          vendor: form.vendor.trim() || null,
          protein,
          carbs,
          fat,
        })
        .eq("id", editId)
        .eq("owner_id", userId);
      if (error) return setError(error.message);

      // po update přepočítej z DB (kvůli pravidlům sloučení vendor/nevendor)
      await loadIngredients(userId);
      setEditId(null);
      setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
    } else {
      const { error } = await supabase
        .from("ingredients")
        .insert({
          name: form.name.trim(),
          vendor: form.vendor.trim() || null,
          protein,
          carbs,
          fat,
        });
      if (error) return setError(error.message);

      await loadIngredients(userId);
      setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
    }
  }

  function startEdit(i: Ingredient) {
    if (i.owner_id !== userId) return;
    setEditId(i.id);
    setForm({
      name: i.name,
      vendor: i.vendor ?? "",
      protein: String(i.protein),
      carbs: String(i.carbs),
      fat: String(i.fat),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(id: string) {
    if (!confirm("Smazat tuto surovinu?")) return;
    setError(null);
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) return setError(error.message);
    // po smazání načti z DB, aby se případné vendorless stejného názvu znovu „objevily“
    await loadIngredients(userId);
    if (editId === id) {
      setEditId(null);
      setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
    }
  }

  const visiblePublic = list.filter((x) => x.owner_id === null).length;
  const visibleOwn = list.filter((x) => x.owner_id === userId).length;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Moje suroviny</h1>
        <Link href="/" className="pill">← Zpět na recepty</Link>
      </div>

      {!userId && (
        <div className="card p-4 text-sm">
          Pro přidávání/úpravy se prosím přihlas — veřejnou knihovnu surovin vidíš i bez přihlášení.
        </div>
      )}

      <form onSubmit={onSubmit} className="card p-4 space-y-3">
        <div className="font-medium">{editId ? "Upravit surovinu" : "Přidat surovinu"}</div>
        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="border rounded px-3 py-2" placeholder="Název *"
                 value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
          <input className="border rounded px-3 py-2" placeholder="Výrobce / prodejce (nepovinné)"
                 value={form.vendor} onChange={(e) => setForm((v) => ({ ...v, vendor: e.target.value }))} />
          <input className="border rounded px-3 py-2" placeholder="Bílkoviny na 100 g (g) *" inputMode="decimal"
                 value={form.protein} onChange={(e) => setForm((v) => ({ ...v, protein: e.target.value }))} />
          <input className="border rounded px-3 py-2" placeholder="Sacharidy na 100 g (g) *" inputMode="decimal"
                 value={form.carbs} onChange={(e) => setForm((v) => ({ ...v, carbs: e.target.value }))} />
          <input className="border rounded px-3 py-2" placeholder="Tuky na 100 g (g) *" inputMode="decimal"
                 value={form.fat} onChange={(e) => setForm((v) => ({ ...v, fat: e.target.value }))} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-primary">{editId ? "Uložit změny" : "Uložit do mých surovin"}</button>
          {editId && (
            <button type="button"
                    onClick={() => { setEditId(null); setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" }); }}
                    className="px-3 py-2 rounded border">
              Zrušit úpravy
            </button>
          )}
          <div className="text-xs text-gray-600">
            Veřejné v DB: {publicCount} · Moje v DB: {ownCount} · Zobrazeno po sloučení: {list.length}
            <br />Viditelné veřejné: {visiblePublic} · Viditelné moje: {visibleOwn}
          </div>
        </div>
      </form>

      <section className="card p-4">
        <div className="font-medium mb-3">Knihovna surovin</div>
        {loading ? (
          <div className="text-sm text-gray-600">Načítám…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-gray-600">Zatím žádné suroviny.</div>
        ) : (
          <ul className="divide-y">
            {list.map((s) => {
              const isMine = s.owner_id === userId;
              return (
                <li key={s.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {s.name} {s.vendor && <span className="text-xs text-gray-500">({s.vendor})</span>}
                    </div>
                    <div className="text-xs text-gray-600">
                      P {s.protein} g · S {s.carbs} g · T {s.fat} g / 100 g
                    </div>
                  </div>
                  {isMine ? (
                    <>
                      <button className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => startEdit(s)}>
                        Upravit
                      </button>
                      <button className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                              onClick={() => remove(s.id)}>
                        Smazat
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                      Veřejná
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
