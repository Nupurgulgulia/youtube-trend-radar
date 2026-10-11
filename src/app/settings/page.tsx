import { redirect } from "next/navigation";
import { logout } from "../actions";
import { isAdmin } from "@/lib/auth";
import { loadSettings } from "@/lib/store";
import SettingsForm from "./SettingsForm";

// Map step 1: Ishaan edits categories, keywords, region, language, category IDs and email.
export const dynamic = "force-dynamic";

export default async function Settings() {
  if (!(await isAdmin())) redirect("/login?next=/settings");
  const settings = await loadSettings();
  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Changes apply from the next run.</p>
      <SettingsForm settings={settings} />
      <form action={logout}>
        <button type="submit">Log out</button>
      </form>
    </>
  );
}
