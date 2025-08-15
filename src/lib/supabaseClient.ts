"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Jediný sdílený klient pro celou appku (Client Components)
const _client = createSupabaseClient(url, anon);

export const supabase = _client;
/** Kompatibilní helper – vrací stejný singleton. */
export function createClient() {
  return _client;
}
