import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

// Server-side database client (map step 5, Neon Postgres). The connection string
// holds the database password, so this file must never be imported by browser code.
// The "server-only" import above makes the build fail if that ever happens.
//
// Usage: const rows = await db()`select * from settings where id = ${1}`;
// Values inside ${} are sent as parameters, never pasted into the SQL text.

let client: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (!client) {
    client = neon(env("DATABASE_URL"));
  }
  return client;
}
