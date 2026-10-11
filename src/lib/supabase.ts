import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// Server-side Supabase client (map step 5). It uses the service-role key, which
// bypasses Row Level Security, so this file must never be imported by browser code.
// The "server-only" import above makes the build fail if that ever happens.

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
