import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #51 decision: the DB part of a hard delete must be ONE atomic SQL function
// (a plpgsql function body runs inside a single transaction), never a series
// of per-table deletes issued from TypeScript.
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("hard delete is a single atomic SQL function", () => {
  const ts = read("lib/privacy/delete.ts");

  it("app code issues no direct table deletes", () => {
    expect(ts).not.toMatch(/\.from\([^)]*\)[\s\S]{0,80}\.delete\(/);
  });

  it("app code calls the delete_user_data RPC exactly once", () => {
    expect(ts.match(/\.rpc\(\s*["']delete_user_data["']/g) ?? []).toHaveLength(1);
  });

  it("migration defines delete_user_data as one plpgsql function without commit/autonomous steps", () => {
    const sql = read("supabase/migrations/20261011120000_user_data_rights.sql").toLowerCase();
    expect(sql).toMatch(/create or replace function public\.delete_user_data/);
    expect(sql).toMatch(/language plpgsql/);
    expect(sql).not.toMatch(/\bcommit\b|dblink|pg_background/);
  });
});
