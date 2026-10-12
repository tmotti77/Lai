import { describe, it, expect } from "vitest";
import { he } from "@/lib/i18n/he";
import { deleteErrorMessage, exportErrorMessage } from "@/components/settings/messages";

// Pins the client to the real route contracts in app/api/me/export/route.ts and
// app/api/me/route.ts (#51 part 2, plan §4.3).
const ex = he.settings.export.errors;
const del = he.settings.delete.errors;

describe("exportErrorMessage", () => {
  it.each([
    [401, "session_expired", ex.sessionExpired],
    [401, "no_identity", ex.noData],
    [503, "disabled", ex.unavailable],
    [503, "auth_unavailable", ex.unavailable],
    [500, "storage_unavailable", ex.generic],
    [500, "internal", ex.generic],
    [502, undefined, ex.generic],
    [0, undefined, ex.generic],
  ])("%i %s", (status, error, expected) => {
    expect(exportErrorMessage(status, error)).toBe(expected);
  });

  it("429 rate_limited fills in retry_after_s", () => {
    const msg = exportErrorMessage(429, "rate_limited", 60);
    expect(msg).toBe(ex.rateLimited.replace("{seconds}", "60"));
    expect(msg).toContain("60");
    expect(msg).not.toContain("{seconds}");
  });

  it("429 without retry_after_s falls back to the 60 s cooldown", () => {
    expect(exportErrorMessage(429, "rate_limited")).toContain("60");
  });
});

describe("deleteErrorMessage", () => {
  it.each([
    [400, "confirmation_required", del.generic],
    [403, "bad_origin", del.generic],
    [401, "session_expired", del.sessionExpired],
    [401, "no_identity", del.noData],
    [409, "deletion_in_progress", del.inProgress],
    [500, "deletion_incomplete", del.incomplete],
    [500, "internal", del.generic],
    [503, "disabled", del.unavailable],
    [503, "auth_unavailable", del.unavailable],
    [0, undefined, del.generic],
  ])("%i %s", (status, error, expected) => {
    expect(deleteErrorMessage(status, error)).toBe(expected);
  });
});
