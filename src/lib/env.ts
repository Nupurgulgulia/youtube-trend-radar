import { z } from "zod";

// Server-only configuration. Values are read when first needed, so a missing key
// fails with a clear message instead of crashing the whole app at start-up.
// Never log the returned object: it holds secrets.

const required = z.string().min(1);

const schemas = {
  YOUTUBE_API_KEY: required,
  GEMINI_API_KEY: required,
  GEMINI_MODEL: required,
  DATABASE_URL: z.string().startsWith("postgres"),
  RESEND_API_KEY: required,
  BRIEF_FROM_EMAIL: required,
  BRIEF_TO_EMAIL: required,
  CRON_SECRET: required,
  ADMIN_PASSWORD: required,
  APP_URL: z.url(),
  YOUTUBE_DAILY_QUOTA: z.coerce.number().int().positive(),
  YOUTUBE_SEARCH_DAILY_LIMIT: z.coerce.number().int().positive(),
  QUOTA_SAFETY_MARGIN: z.coerce.number().gt(0).max(1),
} as const;

type EnvName = keyof typeof schemas;
type EnvValue<K extends EnvName> = z.infer<(typeof schemas)[K]>;

export function env<K extends EnvName>(name: K): EnvValue<K> {
  const result = schemas[name].safeParse(process.env[name]);
  if (!result.success) {
    // Only the variable name goes into the message, never its value.
    throw new Error(`Environment variable ${name} is missing or invalid. See .env.example.`);
  }
  return result.data as EnvValue<K>;
}
