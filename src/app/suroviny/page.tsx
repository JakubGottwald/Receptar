/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function SurovinyPage() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<Ingredient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // form (create / edit)
  const [form, setForm] = useState({
    name: "",
    vendor: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [editId, setEditId] = useState<string | null>(null);

  // Pomocná: bezpečný parse (povolí i "20,5")
  const parseNum = (s: string) => {
    const v = s.replace(/\s+/g, "").replace(",", ".");
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  };

  // Deduplikace (pokud je stejný název a jednou je vendor a podruhé není, necháme ten s vendorem)
  function dedupe(arr: Ingredient[]) {
    const byKey = new Map<string, Ingredient>();
    for (const it of arr) {
      const key = it.name.trim().toLowerCase();
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, it);
      } else {
        // preferuj s vyplněným vendor
        const candidate =
          prev.vendor && prev.vendor.trim()
            ? prev
            : it.vendor && it.vendor.trim()
            ? it
            : prev; // obě bez vendor -> nech první
        byKey.set(key, candidate);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      setMsg(null);

      // Přihlášený uživatel
      const { data: sess } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(sess.session?.user?.id ?? null);

      // Načti suroviny (RLS vrátí veřejné + moje)
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .order("name", { ascending: true });

      if (!mounted) return;

      if (error) {
        setError(error.message);
        setList([]);
      } else {
        setList(dedupe((data ?? []) as Ingredient[]));
      }

      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  /** uložit (vytvořit/aktualizovat) */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const protein = parseNum(form.protein);
    const carbs = parseNum(form.carbs);
    const fat = parseNum(form.fat);

    if (!form.name.trim() || Number.isNaN(protein) || Number.isNaN(carbs) || Number.isNaN(fat)) {
      setError("Vyplň název a čísla pro B/S/T (můžeš psát i s čárkou).");
      return;
    }

    if (!userId) {
      setError("Pro ukládání je potřeba se přihlásit.");
      return;
    }

    setSaving(true);

    if (editId) {
      // UPDATE jen vlastních
      const { data, error } = await supabase
        .from("ingredients")
        .update({
          name: form.name.trim(),
          vendor: form.vendor.trim() || null,
          protein,
          carbs,
          fat,
        })
        .eq("id", editId)
        .eq("owner_id", userId)
        .select("*")
        .maybeSingle<Ingredient>();

      setSaving(false);

      if (error) {
        setError(error.message);
        return;
      }

      if (data) {
        setList((prev) =>
          dedupe(
            prev.map((i) =>
              i.id === editId
                ? {
                    ...i,
                    name: data.name,
                    vendor: data.vendor,
                    protein: data.protein,
                    carbs: data.carbs,
                    fat: data.fat,
                  }
                : i
            )
          )
        );
        setMsg("Surovina upravena ✅");
      }
      setEditId(null);
    } else {
      // INSERT – pošleme owner_id přímo (nespoléhej na trigger)
      const { data, error } = await supabase
        .from("ingredients")
        .insert({
          owner_id: userId,
          name: form.name.trim(),
          vendor: form.vendor.trim() || null,
          protein,
          carbs,
          fat,
        })
        .select("*")
        .maybeSingle<Ingredient>();

      setSaving(false);

      if (error) {
        setError(error.message);
        return;
      }

      if (data) {
        setList((prev) => dedupe([...prev, data]));
        setMsg("Uloženo do mých surovin ✅");
      }
    }

    setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
  }

  function startEdit(i: Ingredient) {
    if (i.owner_id !== userId) return; // jen vlastní
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
    setMsg(null);
    const { error } = await supabase.from("ingredients").delete().eq("id", id).eq("owner_id", userId ?? "");
    if (error) return setError(error.message);
    setList((prev) => prev.filter((x) => x.id !== id));
    if (editId === id) {
      setEditId(null);
      setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
    }
    setMsg("Surovina smazána ✅");
  }

  const publicCount = list.filter((x) => x.owner_id === null).length;
  const ownCount = list.filter((x) => x.owner_id === userId).length;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Moje suroviny</h1>
        <Link href="/" className="pill">← Zpět na recepty</Link>
      </div>

      {/* info o přihlášení */}
      {!userId && (
        <div className="card p-4 text-sm">
          Pro přidávání/úpravy se prosím přihlas — veřejnou knihovnu surovin vidíš i bez přihlášení.
        </div>
      )}

      {/* formulář */}
      <form onSubmit={onSubmit} className="card p-4 space-y-3">
        <div className="font-medium">{editId ? "Upravit surovinu" : "Přidat surovinu"}</div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {msg && <div className="text-sm text-emerald-700">{msg}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="border rounded px-3 py-2"
            placeholder="Název *"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Výrobce / prodejce (nepovinné)"
            value={form.vendor}
            onChange={(e) => setForm((v) => ({ ...v, vendor: e.target.value }))}
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Bílkoviny na 100 g (g) *"
            inputMode="decimal"
            value={form.protein}
            onChange={(e) => setForm((v) => ({ ...v, protein: e.target.value }))}
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Sacharidy na 100 g (g) *"
            inputMode="decimal"
            value={form.carbs}
            onChange={(e) => setForm((v) => ({ ...v, carbs: e.target.value }))}
          />
          <input
            className="border rounded px-3 py-2"
            placeholder="Tuky na 100 g (g) *"
            inputMode="decimal"
            value={form.fat}
            onChange={(e) => setForm((v) => ({ ...v, fat: e.target.value }))}
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="submit" className="btn-primary disabled:opacity-60" disabled={saving}>
            {saving ? "Ukládám…" : editId ? "Uložit změny" : "Uložit do mých surovin"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setForm({ name: "", vendor: "", protein: "", carbs: "", fat: "" });
                setMsg(null);
                setError(null);
              }}
              className="px-3 py-2 rounded border"
            >
              Zrušit úpravy
            </button>
          )}
          <div className="text-xs text-gray-600">
            Veřejné: {publicCount} · Moje: {ownCount}
          </div>
        </div>
      </form>

      {/* seznam surovin */}
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
                      <button
                        className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => startEdit(s)}
                      >
                        Upravit
                      </button>
                      <button
                        className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700"
                        onClick={() => remove(s.id)}
                      >
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
