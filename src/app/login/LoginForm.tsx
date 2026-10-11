"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, { error: null });
  return (
    <form action={action} className="card" style={{ maxWidth: 380 }}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {state.error && <p className="errors">{state.error}</p>}
      <p style={{ marginTop: 14 }}>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Checking..." : "Log in"}
        </button>
      </p>
    </form>
  );
}
