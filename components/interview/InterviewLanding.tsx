"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { he } from "@/lib/i18n/he";
import { Button } from "@/components/ui/button";
import {
  PERSONA_IDS,
  type PersonaId,
  type InterviewSession,
} from "@/lib/interview/types";
import { PersonaSelector } from "./PersonaSelector";
import { TargetRolePicker } from "./TargetRolePicker";
import { HistoryList } from "./HistoryList";

export function InterviewLanding({
  history,
  topRoles,
}: {
  history: InterviewSession[];
  topRoles: Array<{ id: string; name_he: string }>;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaId>("hr");
  const [targetOccupationId, setTargetOccupationId] = useState<string | null>(
    topRoles[0]?.id ?? null,
  );
  const [targetFreeText, setTargetFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart =
    (targetOccupationId !== null || targetFreeText.trim().length > 0) &&
    PERSONA_IDS.includes(persona);

  async function start() {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      const body = targetOccupationId
        ? { action: "start", persona, target_occupation_id: targetOccupationId }
        : { action: "start", persona, target_role_he: targetFreeText.trim() };
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(he.interview.errors.startFailed);
        return;
      }
      const json = (await res.json()) as { sessionId: string };
      router.push(`/interview/${json.sessionId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{he.interview.landing.title}</h1>
        <p className="text-muted-foreground">{he.interview.landing.subtitle}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-medium">
          {he.interview.landing.personaSectionTitle}
        </h2>
        <PersonaSelector value={persona} onChange={setPersona} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium">
          {he.interview.landing.targetSectionTitle}
        </h2>
        <TargetRolePicker
          topRoles={topRoles}
          occupationId={targetOccupationId}
          onSelectOccupation={(id) => {
            setTargetOccupationId(id);
            setTargetFreeText("");
          }}
          freeText={targetFreeText}
          onChangeFreeText={(t) => {
            setTargetFreeText(t);
            if (t.trim().length > 0) setTargetOccupationId(null);
          }}
        />
      </section>

      <div className="flex items-center justify-between">
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : (
          <span />
        )}
        <Button onClick={start} disabled={!canStart || busy}>
          {he.interview.landing.start}
        </Button>
      </div>

      <section className="space-y-3 border-t pt-6">
        <h2 className="text-base font-medium">
          {he.interview.landing.historyTitle}
        </h2>
        <HistoryList sessions={history} />
      </section>
    </div>
  );
}
