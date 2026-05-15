"use client";

import { useId } from "react";
import { he } from "@/lib/i18n/he";

export function TargetRolePicker({
  topRoles,
  occupationId,
  onSelectOccupationAction,
  freeText,
  onChangeFreeTextAction,
}: {
  topRoles: Array<{ id: string; name_he: string }>;
  occupationId: string | null;
  onSelectOccupationAction: (id: string | null) => void;
  freeText: string;
  onChangeFreeTextAction: (next: string) => void;
}) {
  const customId = useId();
  return (
    <div className="space-y-3">
      {topRoles.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {he.interview.landing.targetFromRecs}
          </label>
          <select
            value={occupationId ?? ""}
            onChange={(e) => onSelectOccupationAction(e.target.value || null)}
            className="w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="">—</option>
            {topRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name_he}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={customId} className="mb-1 block text-xs text-muted-foreground">
          {he.interview.landing.targetCustom}
        </label>
        <input
          id={customId}
          type="text"
          value={freeText}
          onChange={(e) => onChangeFreeTextAction(e.target.value)}
          placeholder={he.interview.landing.targetCustomPlaceholder}
          maxLength={120}
          className="w-full rounded-md border bg-background px-3 py-2"
        />
      </div>
    </div>
  );
}
