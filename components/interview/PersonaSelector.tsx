"use client";

import { he } from "@/lib/i18n/he";
import { PERSONA_IDS, type PersonaId } from "@/lib/interview/types";

export function PersonaSelector({
  value,
  onChangeAction,
}: {
  value: PersonaId;
  onChangeAction: (next: PersonaId) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PERSONA_IDS.map((id) => {
        const selected = value === id;
        const persona = he.interview.persona[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChangeAction(id)}
            aria-pressed={selected}
            className={`rounded-xl border p-4 text-right transition-shadow ${
              selected ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:shadow-sm"
            }`}
          >
            <div className="text-base font-semibold">{persona.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{persona.description}</div>
          </button>
        );
      })}
    </div>
  );
}
