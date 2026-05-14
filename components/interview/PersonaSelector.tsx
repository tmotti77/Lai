"use client";

import type { PersonaId } from "@/lib/interview/types";

export function PersonaSelector(_: {
  value: PersonaId;
  onChange: (next: PersonaId) => void;
}) {
  return <div data-stub="PersonaSelector" />;
}
