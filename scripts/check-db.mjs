// Checks that DATABASE_URL in .env.local reaches the Neon database and the schema is there.
// Run with: npm run check:db
// Prints table names and the settings row only, never the connection string.
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name`;
const [settings] = await sql`select region_code, keywords, category_ids from settings where id = 1`;

console.log("Connected. Tables:", tables.map((t) => t.table_name).join(", "));
console.log("Settings row:", settings ?? "missing");
