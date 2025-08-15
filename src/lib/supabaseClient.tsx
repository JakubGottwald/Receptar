// src/lib/supabaseClient.ts
import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Vytvoří nový Supabase client pro prohlížeč (NEXT_PUBLIC_* env proměnné). */
export function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createSupabaseBrowserClient(url, anon);
}

/** Alias kvůli starším importům */
export const createBrowserClient = createClient;

/** Default export pro pohodlné importy */
export default createClient;
