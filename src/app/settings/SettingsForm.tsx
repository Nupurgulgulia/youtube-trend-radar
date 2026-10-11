"use client";

import { useActionState } from "react";
import type { Settings } from "@/lib/types";
import { updateSettings } from "../actions";

export default function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(updateSettings, { errors: [], saved: false });
  return (
    <form action={action} className="card">
      <label htmlFor="categories">
        Categories <span className="muted">(comma or one per line; tells the AI what your channel covers)</span>
      </label>
      <textarea id="categories" name="categories" rows={3} defaultValue={settings.categories.join("\n")} />

      <label htmlFor="keywords">
        Keywords <span className="muted">(one per line, most important first; each one is a YouTube search)</span>
      </label>
      <textarea id="keywords" name="keywords" rows={7} defaultValue={settings.keywords.join("\n")} />

      <label htmlFor="regionCode">
        Region <span className="muted">(2-letter code, e.g. IN)</span>
      </label>
      <input id="regionCode" name="regionCode" type="text" defaultValue={settings.regionCode} />

      <label htmlFor="relevanceLanguage">
        Language <span className="muted">(2-letter code, e.g. en)</span>
      </label>
      <input id="relevanceLanguage" name="relevanceLanguage" type="text" defaultValue={settings.relevanceLanguage} />

      <label htmlFor="categoryIds">
        YouTube category IDs <span className="muted">(comma separated; 28 is Science &amp; Technology)</span>
      </label>
      <input id="categoryIds" name="categoryIds" type="text" defaultValue={settings.categoryIds.join(", ")} />

      <label htmlFor="email">
        Email for the brief <span className="muted">(leave empty to use BRIEF_TO_EMAIL)</span>
      </label>
      <input id="email" name="email" type="email" defaultValue={settings.email} />

      {state.errors.length > 0 && (
        <ul className="errors">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {state.saved && <p className="saved">Saved.</p>}
      <p style={{ marginTop: 16 }}>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Saving..." : "Save settings"}
        </button>
      </p>
    </form>
  );
}
