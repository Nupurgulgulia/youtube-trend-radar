// Checks that GEMINI_API_KEY in .env.local is accepted and GEMINI_MODEL exists.
// Run with: npm run check:gemini
// Prints the HTTP status and Google's error message only, never the key.

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!key || !model) {
  console.error("GEMINI_API_KEY and GEMINI_MODEL must both be set in .env.local.");
  process.exit(1); // nothing is open yet, so exiting immediately is safe
}

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
  headers: { "x-goog-api-key": key },
});
const body = await res.json().catch(() => ({}));

if (res.ok) {
  console.log(`OK: key accepted, model ${body.name} is available (${body.displayName ?? "no display name"}).`);
} else {
  console.error(`FAILED: HTTP ${res.status} ${body.error?.status ?? ""}: ${body.error?.message ?? "no message"}`);
  process.exit(1);
}
