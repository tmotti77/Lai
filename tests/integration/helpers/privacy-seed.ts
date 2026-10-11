import { FakeSupabase, type Row } from "../../mocks/fake-supabase";
import { USER_DATA_TABLES } from "@/lib/privacy/registry";

export const FUTURE = "2999-01-01T00:00:00.000Z";
export const BUCKET = "cv-uploads";

/** A fake whose `delete_user_data` RPC deletes in the registry's reverse (children-first) order. */
export function makeFake(): FakeSupabase {
  return new FakeSupabase({
    deleteOrder: Object.entries(USER_DATA_TABLES)
      .reverse()
      .map(([table, def]) => ({ table, scope: def.scope })),
  });
}

export interface SeededUser {
  userId: string;
  authId: string | null;
  anonToken: string | null;
  rows: Record<string, Row[]>;
  /** Every id this user owns, for the cross-user leak scan. */
  ownedIds: string[];
  /** Storage paths that exist for this user (one with a cv_uploads row, one orphan). */
  objectPaths: string[];
  missingObjectPath: string;
}

/**
 * Seeds one user with rows in all 14 user tables:
 * - two career_profile rows: one linked to a conversation, one orphan (conversation_id null);
 * - two cv_uploads rows: one whose object exists, one whose object is gone;
 * - one storage object with no cv_uploads row (upload succeeded, row insert failed).
 */
export function seedUser(
  fake: FakeSupabase,
  opts: { authId?: string; anonToken?: string; messages?: number; isAnonymous?: boolean } = {},
): SeededUser {
  const rows: Record<string, Row[]> = {};
  const add = (table: string, row: Row) => {
    const r = fake.insertRow(table, row);
    (rows[table] ??= []).push(r);
    return r;
  };

  const user = add("users", {
    auth_id: opts.authId ?? null,
    is_anonymous: opts.isAnonymous ?? !opts.authId,
    email: opts.authId ? `${opts.authId}@example.com` : null,
  });
  const userId = user.id as string;
  if (opts.authId) fake.authUsers.add(opts.authId);

  // Authed users can keep a leftover session row; it must be exported (redacted) and deleted.
  add("anonymous_sessions", { token: opts.anonToken ?? `stale-${userId}`, user_id: userId, expires_at: FUTURE });
  add("consents", { user_id: userId, purpose: "processing", version: "2026-05-10" });
  add("consents", { user_id: userId, purpose: "disclaimer", version: "2026-05-10" });

  const conv = add("conversations", { user_id: userId, stage: "skills" });
  for (let i = 0; i < (opts.messages ?? 3); i++) {
    add("messages", {
      conversation_id: conv.id,
      role: i % 2 ? "assistant" : "user",
      content: `msg ${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    });
  }
  add("assessments", { user_id: userId, type: "riasec", responses: {}, scores: {}, items_version: 1 });
  add("career_profile", { user_id: userId, conversation_id: conv.id, data: { linked: true } });
  add("career_profile", { user_id: userId, conversation_id: null, data: { orphan: true } });
  const rec = add("recommendations", { user_id: userId, profile_hash: "h", rankings: [], paths: {}, prose: {} });
  const plan = add("plans", { user_id: userId, recommendation_id: rec.id, archetype: "apply" });
  add("plan_tasks", { plan_id: plan.id, day: 1, title_he: "t", description_he: "d", category: "action", estimated_minutes: 30 });
  add("plan_tasks", { plan_id: plan.id, day: 2, title_he: "t", description_he: "d", category: "research", estimated_minutes: 30 });

  const presentPath = `${userId}/cv-present.pdf`;
  const missingPath = `${userId}/cv-missing.pdf`;
  const orphanPath = `${userId}/cv-orphan.docx`;
  add("cv_uploads", { user_id: userId, storage_path: presentPath, original_filename: "my-cv.pdf", mime_type: "application/pdf", size_bytes: 2048 });
  add("cv_uploads", { user_id: userId, storage_path: missingPath, original_filename: "old-cv.pdf", mime_type: "application/pdf", size_bytes: 1024 });
  fake.putObject(BUCKET, presentPath, 2048);
  fake.putObject(BUCKET, orphanPath, 4096);

  const session = add("interview_sessions", { user_id: userId, persona: "hr", target_role_he: "מפתח" });
  add("interview_messages", { session_id: session.id, role: "assistant", content: "q1" });
  add("interview_messages", { session_id: session.id, role: "user", content: "a1" });
  add("feedback", { user_id: userId, surface: "nps", nps_score: 9, nps_trigger: "plan_generated", comment_he: "טוב" });

  const ownedIds = Object.entries(rows).flatMap(([table, rs]) =>
    rs.map((r) => String(table === "anonymous_sessions" ? r.token : r.id)),
  );
  return {
    userId,
    authId: opts.authId ?? null,
    anonToken: opts.anonToken ?? null,
    rows,
    ownedIds,
    objectPaths: [presentPath, orphanPath],
    missingObjectPath: missingPath,
  };
}

/** Number of rows in each user table that belong to `userId`, resolving children via parents. */
export function ownedCounts(fake: FakeSupabase, userId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const owned = new Map<string, Set<unknown>>();
  for (const [table, def] of Object.entries(USER_DATA_TABLES)) {
    const scope = def.scope as { kind: string; parent?: string; fk?: string };
    const rs = fake.rows(table).filter((r) =>
      scope.kind === "root"
        ? r.id === userId
        : scope.kind === "user_id"
          ? r.user_id === userId
          : owned.get(scope.parent!)?.has(r[scope.fk!]),
    );
    owned.set(table, new Set(rs.map((r) => r.id)));
    out[table] = rs.length;
  }
  return out;
}
