"use client";

import { useState } from "react";

/** Simple, honest strength hint: length matters most, variety helps. */
export function passwordStrength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (p.length < 8) return { score: 0, label: "At least 8 characters" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (p.length >= 12 && kinds >= 3) return { score: 3, label: "Strong" };
  if (p.length >= 10 || kinds >= 3) return { score: 2, label: "Good" };
  return { score: 1, label: "Okay: add numbers or symbols" };
}

/** Password field with a show / hide button and, for new passwords, a strength meter. */
export default function PasswordInput({ id, value, onChange, autoComplete, meter = false }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password"; meter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  return (
    <>
      <div className="pw">
        <input id={id} type={show ? "text" : "password"} required minLength={meter ? 8 : undefined} maxLength={128}
          value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls={id}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {meter && value.length > 0 && (
        <div className={`pw-meter s${strength.score}`} aria-live="polite">
          <span /><span /><span />
          <em>{strength.label}</em>
        </div>
      )}
    </>
  );
}
