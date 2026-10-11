import type { Database } from "@/lib/db/types.gen";

/**
 * Single source of truth for which tables and storage buckets hold user data (#51).
 * Export reads these and deletion removes them. tests/unit/privacy/coverage.test.ts
 * parses supabase/migrations and fails when a new user table or bucket isn't listed here.
 */

export type TableName = keyof Database["public"]["Tables"];

export type Scope =
  | { kind: "root" } // users itself
  | { kind: "user_id" } // WHERE user_id = <id>
  | { kind: "parent"; parent: TableName; fk: string }; // WHERE <fk> IN (owned parent ids)

export interface TableSpec {
  scope: Scope;
  /** Primary key, used for stable pagination. Defaults to "id". */
  pk?: string;
  /** Columns replaced with "[redacted]" in exports. */
  redact?: readonly string[];
}

// Order matters: parents before children, so export can scope children by parent ids.
// Deletion (the SQL function) runs in the reverse order.
export const USER_DATA_TABLES = {
  users: { scope: { kind: "root" } },
  // The token is a live bearer credential; an export file may be shared.
  anonymous_sessions: { scope: { kind: "user_id" }, pk: "token", redact: ["token"] },
  consents: { scope: { kind: "user_id" } },
  conversations: { scope: { kind: "user_id" } },
  messages: { scope: { kind: "parent", parent: "conversations", fk: "conversation_id" } },
  assessments: { scope: { kind: "user_id" } },
  // By user_id, never via conversation: orphan rows have conversation_id IS NULL.
  career_profile: { scope: { kind: "user_id" } },
  recommendations: { scope: { kind: "user_id" } },
  plans: { scope: { kind: "user_id" } },
  plan_tasks: { scope: { kind: "parent", parent: "plans", fk: "plan_id" } },
  cv_uploads: { scope: { kind: "user_id" } },
  interview_sessions: { scope: { kind: "user_id" } },
  interview_messages: { scope: { kind: "parent", parent: "interview_sessions", fk: "session_id" } },
  feedback: { scope: { kind: "user_id" } },
} as const satisfies Partial<Record<TableName, TableSpec>>;

export type UserDataTable = keyof typeof USER_DATA_TABLES;
export const USER_DATA_TABLE_NAMES = Object.keys(USER_DATA_TABLES) as UserDataTable[];

// Shared catalog data, identical for every user: nothing to export or delete.
export const NON_USER_TABLES = [
  "skills", // skills taxonomy
  "occupations", // occupations catalog
  "catalog_version", // single-row catalog version counter
] as const;

export const STORAGE_BUCKETS = {
  // Path convention <users.id>/<uuid>.{pdf,docx} (app/api/cv/upload/route.ts).
  "cv-uploads": { folder: (userId: string) => userId },
} as const;

export type StorageBucket = keyof typeof STORAGE_BUCKETS;
