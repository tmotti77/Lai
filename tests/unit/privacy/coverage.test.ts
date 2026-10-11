import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { USER_DATA_TABLES, NON_USER_TABLES, STORAGE_BUCKETS } from "@/lib/privacy/registry";
import {
  parseMigrations,
  userScopedTables,
  coverageProblems,
  fkEdges,
  type MigrationFile,
} from "./migration-parser";

// The guard issue #51 asks for: a new table that holds user data, or a new storage
// bucket, must fail CI until lib/privacy/registry.ts handles it for export and delete.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const files: MigrationFile[] = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
const model = parseMigrations(files);
const registryTables = Object.keys(USER_DATA_TABLES);

describe("privacy registry ↔ migrations coverage", () => {
  it("(f) parser self-test: detects exactly the 14 known user-scoped tables", () => {
    expect([...userScopedTables(model)].sort()).toEqual(
      [
        "anonymous_sessions",
        "assessments",
        "career_profile",
        "consents",
        "conversations",
        "cv_uploads",
        "feedback",
        "interview_messages",
        "interview_sessions",
        "messages",
        "plan_tasks",
        "plans",
        "recommendations",
        "users",
      ].sort(),
    );
  });

  it("(a)+(b) every user-scoped table is in the registry, and every table is classified", () => {
    expect(coverageProblems(model, registryTables, NON_USER_TABLES)).toEqual([]);
  });

  it("(f) the guard fails when a new user table is added without handling", () => {
    const withNewTable = parseMigrations([
      ...files,
      { name: "29990101000000_new.sql", sql: "create table foo (id uuid primary key, user_id uuid references users(id));" },
      { name: "29990101000001_new.sql", sql: "CREATE TABLE IF NOT EXISTS public.bar (id uuid, owner_id uuid);" },
      { name: "29990101000002_new.sql", sql: "create table baz (id uuid, foo_id uuid not null references public.foo(id) on delete cascade);" },
    ]);
    const problems = coverageProblems(withNewTable, registryTables, NON_USER_TABLES).join("\n");
    expect(problems).toMatch(/table foo holds user data but is not in lib\/privacy\/registry\.ts/);
    expect(problems).toMatch(/table bar holds user data/); // owner column, no FK
    expect(problems).toMatch(/table baz holds user data/); // transitive through foo
  });

  it("(b) the guard fails when a non-user table is added without classification", () => {
    const withLookup = parseMigrations([...files, { name: "29990101000000_x.sql", sql: "create table lookups (id text primary key);" }]);
    expect(coverageProblems(withLookup, registryTables, NON_USER_TABLES).join("\n")).toMatch(/table lookups is not classified/);
  });

  it("registry order lists parents before children (export reads parents first)", () => {
    const scoped = new Set(registryTables);
    for (const { child, parent } of fkEdges(model, scoped)) {
      expect(registryTables.indexOf(parent), `${parent} must come before ${child}`).toBeLessThan(
        registryTables.indexOf(child),
      );
    }
    expect(registryTables[0]).toBe("users");
  });

  it("registry parent scopes match real foreign keys", () => {
    for (const [table, def] of Object.entries(USER_DATA_TABLES)) {
      const scope = def.scope as { kind: string; parent?: string; fk?: string };
      if (scope.kind !== "parent") continue;
      const col = model.tables.get(table)!.find((c) => c.name === scope.fk);
      expect(col?.references, `${table}.${scope.fk}`).toBe(scope.parent);
    }
  });

  it("(c) the newest delete_user_data deletes every registry table, children before parents, users last", () => {
    const body = model.functionBodies.get("delete_user_data");
    expect(body, "migration defining public.delete_user_data").toBeDefined();
    const order = [...body!.matchAll(/delete\s+from\s+(?:public\.)?([a-z_]+)/g)].map((m) => m[1]);

    expect([...new Set(order)].sort()).toEqual([...registryTables].sort());
    expect(order.at(-1)).toBe("users");
    for (const { child, parent } of fkEdges(model, new Set(registryTables))) {
      expect(order.indexOf(child), `${child} must be deleted before ${parent}`).toBeLessThan(order.indexOf(parent));
    }
  });

  it("(d) every storage bucket in the migrations is handled by the registry", () => {
    expect(model.buckets.size).toBeGreaterThan(0);
    for (const bucket of model.buckets) {
      expect(Object.keys(STORAGE_BUCKETS), `bucket ${bucket}`).toContain(bucket);
    }
  });

  it("(e) every non-root registry table has an on-delete-cascade path to users", () => {
    const scoped = new Set(registryTables);
    const cascades = fkEdges(model, scoped).filter((e) => e.onDelete === "cascade");
    for (const table of registryTables.filter((t) => t !== "users")) {
      const seen = new Set([table]);
      const queue = [table];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const e of cascades.filter((e) => e.child === cur && !seen.has(e.parent))) {
          seen.add(e.parent);
          queue.push(e.parent);
        }
      }
      expect(seen.has("users"), `${table} cascades to users`).toBe(true);
    }
  });

  it("every SECURITY DEFINER function has a matching REVOKE EXECUTE from public, anon, authenticated", () => {
    expect(model.securityDefinerFunctions.has("delete_user_data")).toBe(true);
    for (const fn of model.securityDefinerFunctions) {
      expect(model.revokedFunctions.has(fn), `revoke execute on ${fn}`).toBe(true);
    }
  });
});
