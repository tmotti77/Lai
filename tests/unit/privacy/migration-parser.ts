/**
 * Test-local, dependency-free reader for supabase/migrations/*.sql.
 *
 * It understands only the shapes our migrations use (create table, alter table … add
 * column, insert into storage.buckets, create function, revoke execute). It does not need
 * to be a SQL parser: the coverage test pins its output with a snapshot of the known
 * tables, so a parsing regression fails loudly instead of silently shrinking the guard.
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface Column {
  name: string;
  references: string | null;
  onDelete: string | null;
}

export interface MigrationModel {
  tables: Map<string, Column[]>;
  buckets: Set<string>;
  securityDefinerFunctions: Set<string>;
  revokedFunctions: Set<string>;
  /** Newest-file-wins body of each function, keyed by name. */
  functionBodies: Map<string, string>;
}

const IDENT = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Returns the text between the "(" at `open` and its matching ")". */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error("migration-parser: unbalanced parentheses");
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const NON_COLUMN = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/;

function parseColumn(def: string): Column | null {
  if (NON_COLUMN.test(def)) return null;
  const name = def.match(/^"?([a-z_][a-z0-9_]*)"?/)?.[1];
  if (!name) return null;
  // `references auth.users` deliberately does not match: only public tables count.
  const ref = def.match(new RegExp(String.raw`references\s+(?!auth\.)` + IDENT));
  const onDelete = def.match(/on\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/);
  return {
    name,
    references: ref ? ref[1] : null,
    onDelete: onDelete ? onDelete[1].replace(/\s+/g, " ") : null,
  };
}

export function parseMigrations(files: MigrationFile[]): MigrationModel {
  const model: MigrationModel = {
    tables: new Map(),
    buckets: new Set(),
    securityDefinerFunctions: new Set(),
    revokedFunctions: new Set(),
    functionBodies: new Map(),
  };

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = stripComments(file.sql).toLowerCase();

    const createTable = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?` + IDENT + String.raw`\s*\(`, "g");
    for (const m of sql.matchAll(createTable)) {
      const body = balanced(sql, m.index! + m[0].length - 1);
      const cols = splitTopLevel(body).map(parseColumn).filter((c): c is Column => c !== null);
      model.tables.set(m[1], cols);
    }

    const alterTable = new RegExp(
      String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?` + IDENT + String.raw`\s+(add\s+column[^;]*);`,
      "g",
    );
    for (const m of sql.matchAll(alterTable)) {
      const cols = model.tables.get(m[1]) ?? [];
      for (const clause of splitTopLevel(m[2])) {
        const def = clause.replace(/^add\s+column\s+(?:if\s+not\s+exists\s+)?/, "");
        const col = parseColumn(def);
        if (col) cols.push(col);
      }
      model.tables.set(m[1], cols);
    }

    for (const m of sql.matchAll(/insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*([^;]*);/g)) {
      for (const t of m[1].matchAll(/\(\s*'([^']+)'/g)) model.buckets.add(t[1]);
    }

    const createFn = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+` + IDENT + String.raw`\s*\(`, "g");
    for (const m of sql.matchAll(createFn)) {
      const start = m.index!;
      const bodyOpen = sql.indexOf("$$", start);
      const bodyClose = sql.indexOf("$$", bodyOpen + 2);
      const end = sql.indexOf(";", bodyClose);
      const header = sql.slice(start, bodyOpen);
      const tail = sql.slice(bodyClose + 2, end === -1 ? undefined : end);
      if (/security\s+definer/.test(header + tail)) model.securityDefinerFunctions.add(m[1]);
      model.functionBodies.set(m[1], sql.slice(bodyOpen + 2, bodyClose));
    }

    const revoke = new RegExp(
      String.raw`revoke\s+execute\s+on\s+function\s+` + IDENT + String.raw`\s*\([^)]*\)\s+from\s+([^;]+);`,
      "g",
    );
    for (const m of sql.matchAll(revoke)) {
      const roles = new Set(m[2].split(",").map((r) => r.trim()));
      if (["public", "anon", "authenticated"].every((r) => roles.has(r))) model.revokedFunctions.add(m[1]);
    }
  }
  return model;
}

const OWNER_COLUMNS = new Set(["user_id", "auth_id", "owner_id"]);

/**
 * A table holds user data if it is `users`, references a user-scoped table (directly or
 * transitively), or has an owner-named column even without a foreign key.
 */
export function userScopedTables(model: MigrationModel): Set<string> {
  const scoped = new Set<string>(model.tables.has("users") ? ["users"] : []);
  for (const [name, cols] of model.tables) {
    if (cols.some((c) => OWNER_COLUMNS.has(c.name))) scoped.add(name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, cols] of model.tables) {
      if (scoped.has(name)) continue;
      if (cols.some((c) => c.references !== null && scoped.has(c.references))) {
        scoped.add(name);
        changed = true;
      }
    }
  }
  return scoped;
}

/** Every (child → parent) foreign-key edge between two tables of `among`. */
export function fkEdges(model: MigrationModel, among: Set<string>): Array<{ child: string; parent: string; onDelete: string | null }> {
  const edges: Array<{ child: string; parent: string; onDelete: string | null }> = [];
  for (const [child, cols] of model.tables) {
    if (!among.has(child)) continue;
    for (const c of cols) {
      if (c.references && among.has(c.references) && c.references !== child) {
        edges.push({ child, parent: c.references, onDelete: c.onDelete });
      }
    }
  }
  return edges;
}

/** Problems that make the privacy registry out of date with the migrations. Empty = covered. */
export function coverageProblems(
  model: MigrationModel,
  registryTables: readonly string[],
  nonUserTables: readonly string[],
): string[] {
  const problems: string[] = [];
  const scoped = userScopedTables(model);
  const registry = new Set(registryTables);
  const nonUser = new Set(nonUserTables);

  for (const t of scoped) {
    if (!registry.has(t)) {
      problems.push(`table ${t} holds user data but is not in lib/privacy/registry.ts — add export + delete handling`);
    }
  }
  for (const t of registry) {
    if (!scoped.has(t)) problems.push(`registry table ${t} is not a user-scoped table in the migrations`);
  }
  for (const t of model.tables.keys()) {
    if (!registry.has(t) && !nonUser.has(t)) {
      problems.push(`table ${t} is not classified: add it to USER_DATA_TABLES or NON_USER_TABLES in lib/privacy/registry.ts`);
    }
  }
  return problems;
}
