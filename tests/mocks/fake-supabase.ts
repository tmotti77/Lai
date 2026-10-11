/**
 * In-memory stand-in for the subset of supabase-js the privacy code uses.
 *
 * Unlike tests/mocks/supabase-chain.ts, this holds real rows, so a test can seed two
 * users and assert that one user's export or deletion never touches the other's data.
 * It mimics three PostgREST behaviours that matter for correctness:
 *   - `maxRows` truncation (PostgREST's default `max_rows` is 1000), to prove pagination;
 *   - `.or("col.is.null,col.lt.<iso>")` guarded updates, for the atomic locks;
 *   - an all-or-nothing `rpc("delete_user_data")`, mirroring the SQL transaction.
 *
 * Faults are injected per operation name with `failNext(op, skip)`.
 */
import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type FakeError = { message: string; status?: number; code?: string; statusCode?: string };
type Result = { data: unknown; error: FakeError | null };

export type FaultOp =
  | "storage.list"
  | "storage.upload"
  | "storage.remove"
  | "storage.createSignedUrl"
  | "rpc:delete_user_data"
  | "auth.admin.deleteUser";

export interface FakeOptions {
  maxRows?: number;
  /** Child → parent order used by the fake `delete_user_data` RPC (children first). */
  deleteOrder?: ReadonlyArray<{ table: string; scope: DeleteScope }>;
}

export type DeleteScope =
  | { kind: "root" }
  | { kind: "user_id" }
  | { kind: "parent"; parent: string; fk: string };

const PRIMARY_KEYS: Record<string, string> = { anonymous_sessions: "token" };

function parseValue(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Parses the PostgREST `or` grammar we use: `col.op.value` items joined by commas. */
function parseOr(expr: string): Filter {
  const parts = expr.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const value = parseValue(rest.join("."));
    switch (op) {
      case "is":
      case "eq":
        return (r: Row) => (r[col] ?? null) === value;
      case "lt":
        return (r: Row) => r[col] != null && compare(r[col], value) < 0;
      case "gt":
        return (r: Row) => r[col] != null && compare(r[col], value) > 0;
      default:
        throw new Error(`fake-supabase: unsupported or-operator ${op}`);
    }
  });
  return (r) => parts.some((f) => f(r));
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  objects = new Map<string, Map<string, { size: number }>>();
  authUsers = new Set<string>();
  writes: Array<{ op: "insert" | "update" | "delete" | "rpc"; table: string }> = [];
  calls: Array<{ op: string; args: unknown[] }> = [];
  hooks: { beforeRpc?: () => void } = {};
  private faults: Array<{ op: FaultOp; skip: number }> = [];
  readonly maxRows: number;
  private deleteOrder: NonNullable<FakeOptions["deleteOrder"]>;

  constructor(opts: FakeOptions = {}) {
    this.maxRows = opts.maxRows ?? 1000;
    this.deleteOrder = opts.deleteOrder ?? [];
  }

  // ---- seeding / inspection --------------------------------------------------

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  insertRow(table: string, row: Row): Row {
    const full: Row = { ...row };
    const pk = PRIMARY_KEYS[table] ?? "id";
    if (full[pk] === undefined) full[pk] = randomUUID();
    if (full.created_at === undefined) full.created_at = new Date().toISOString();
    if (table === "users" && full.is_anonymous === undefined) full.is_anonymous = true;
    this.rows(table).push(full);
    return full;
  }

  putObject(bucket: string, path: string, size = 1024): void {
    if (!this.objects.has(bucket)) this.objects.set(bucket, new Map());
    this.objects.get(bucket)!.set(path, { size });
  }

  objectPaths(bucket: string): string[] {
    return [...(this.objects.get(bucket)?.keys() ?? [])].sort();
  }

  /** Fail the (skip+1)-th next call of `op`, once. */
  failNext(op: FaultOp, skip = 0): void {
    this.faults.push({ op, skip });
  }

  private consumeFault(op: FaultOp): FakeError | null {
    const i = this.faults.findIndex((f) => f.op === op);
    if (i === -1) return null;
    const f = this.faults[i];
    if (f.skip > 0) {
      f.skip -= 1;
      return null;
    }
    this.faults.splice(i, 1);
    return { message: `injected failure: ${op}`, status: 500 };
  }

  callsOf(op: string): unknown[][] {
    return this.calls.filter((c) => c.op === op).map((c) => c.args);
  }

  // ---- client surface -------------------------------------------------------

  client() {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(this.rpc(fn, args)),
      storage: { from: (bucket: string) => this.bucket(bucket) },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            this.calls.push({ op: "auth.admin.deleteUser", args: [id] });
            const fault = this.consumeFault("auth.admin.deleteUser");
            if (fault) return { data: { user: null }, error: fault };
            if (!this.authUsers.delete(id)) {
              return {
                data: { user: null },
                error: { message: "User not found", status: 404, code: "user_not_found" },
              };
            }
            return { data: { user: { id } }, error: null };
          },
        },
      },
    };
  }

  private rpc(fn: string, args: Record<string, unknown>): Result {
    this.calls.push({ op: `rpc:${fn}`, args: [args] });
    if (fn !== "delete_user_data") {
      return { data: null, error: { message: `fake-supabase: unknown rpc ${fn}` } };
    }
    this.hooks.beforeRpc?.();
    // A failed transaction changes nothing, so failing before any mutation is the rollback.
    const fault = this.consumeFault("rpc:delete_user_data");
    if (fault) return { data: null, error: fault };

    const userId = args.p_user_id as string;
    const pkOf = (table: string, r: Row) => r[PRIMARY_KEYS[table] ?? "id"];
    // Resolve ownership parents-first, then delete children-first, like the SQL function.
    const owned = new Map<string, Set<unknown>>();
    for (const { table, scope } of [...this.deleteOrder].reverse()) {
      const match: Filter =
        scope.kind === "root"
          ? (r) => r.id === userId
          : scope.kind === "user_id"
            ? (r) => r.user_id === userId
            : (r) => owned.get(scope.parent)?.has(r[scope.fk]) ?? false;
      owned.set(table, new Set(this.rows(table).filter(match).map((r) => pkOf(table, r))));
    }
    const counts: Record<string, number> = {};
    for (const { table } of this.deleteOrder) {
      const keys = owned.get(table)!;
      const before = this.rows(table).length;
      this.tables[table] = this.rows(table).filter((r) => !keys.has(pkOf(table, r)));
      counts[table] = before - this.tables[table].length;
    }
    this.writes.push({ op: "rpc", table: "delete_user_data" });
    return { data: counts, error: null };
  }

  private bucket(bucket: string) {
    const store = () => {
      if (!this.objects.has(bucket)) this.objects.set(bucket, new Map());
      return this.objects.get(bucket)!;
    };
    return {
      list: async (folder: string, opts: { limit?: number; offset?: number } = {}) => {
        this.calls.push({ op: "storage.list", args: [bucket, folder, opts] });
        const fault = this.consumeFault("storage.list");
        if (fault) return { data: null, error: fault };
        const prefix = folder ? `${folder}/` : "";
        const names = [...store().entries()]
          .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
          .map(([p, meta]) => ({ name: p.slice(prefix.length), id: p, metadata: { size: meta.size } }))
          .sort((a, b) => compare(a.name, b.name));
        const offset = opts.offset ?? 0;
        return { data: names.slice(offset, offset + (opts.limit ?? 100)), error: null };
      },
      upload: async (path: string, body: unknown, opts: { contentType?: string; upsert?: boolean } = {}) => {
        this.calls.push({ op: "storage.upload", args: [bucket, path, opts] });
        const fault = this.consumeFault("storage.upload");
        if (fault) return { data: null, error: fault };
        if (store().has(path) && !opts.upsert) {
          return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        }
        const size = body instanceof Uint8Array ? body.byteLength : 0;
        store().set(path, { size });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        this.calls.push({ op: "storage.remove", args: [bucket, paths] });
        const fault = this.consumeFault("storage.remove");
        if (fault) return { data: null, error: fault };
        const removed = paths.filter((p) => store().delete(p)).map((name) => ({ name }));
        return { data: removed, error: null };
      },
      createSignedUrl: async (path: string, expiresIn: number, opts?: { download?: string | boolean }) => {
        this.calls.push({ op: "storage.createSignedUrl", args: [bucket, path, expiresIn, opts] });
        const fault = this.consumeFault("storage.createSignedUrl");
        if (fault) return { data: null, error: fault };
        if (!store().has(path)) {
          return { data: null, error: { message: "Object not found", statusCode: "404" } };
        }
        return {
          data: { signedUrl: `https://stub.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` },
          error: null,
        };
      },
    };
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private columns: string | null = "*";
  private returning = false;
  private payload: Row | Row[] | null = null;
  private orderBy: Array<{ col: string; ascending: boolean }> = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitN: number | null = null;

  constructor(
    private fake: FakeSupabase,
    private table: string,
  ) {}

  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    this.columns = null;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    this.columns = null;
    return this;
  }
  delete() {
    this.op = "delete";
    this.columns = null;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) !== value);
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  is(col: string, value: null | boolean) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  gt(col: string, value: unknown) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) > 0);
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) < 0);
    return this;
  }
  or(expr: string) {
    this.filters.push(parseOr(expr));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, ascending: opts.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  maybeSingle(): Promise<Result> {
    const r = this.execute();
    if (r.error) return Promise.resolve(r);
    const rows = r.data as Row[] | null;
    if (!rows || rows.length === 0) return Promise.resolve({ data: null, error: null });
    if (rows.length > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } });
    return Promise.resolve({ data: rows[0], error: null });
  }
  single(): Promise<Result> {
    const r = this.execute();
    if (r.error) return Promise.resolve(r);
    const rows = r.data as Row[] | null;
    if (!rows || rows.length !== 1) return Promise.resolve({ data: null, error: { message: "not single" } });
    return Promise.resolve({ data: rows[0], error: null });
  }
  then<T1 = Result, T2 = never>(
    onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }

  private project(row: Row): Row {
    if (this.columns === null || this.columns.trim() === "*") return { ...row };
    const out: Row = {};
    for (const c of this.columns.split(",").map((s) => s.trim())) out[c] = row[c] ?? null;
    return out;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => f(row));
  }

  private execute(): Result {
    const rows = this.fake.rows(this.table);
    switch (this.op) {
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const inserted = list.map((p) => this.fake.insertRow(this.table, p));
        this.fake.writes.push({ op: "insert", table: this.table });
        return { data: this.returning ? inserted.map((r) => this.project(r)) : null, error: null };
      }
      case "update": {
        const hit = rows.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, this.payload);
        this.fake.writes.push({ op: "update", table: this.table });
        return { data: this.returning ? hit.map((r) => this.project(r)) : null, error: null };
      }
      case "delete": {
        const hit = rows.filter((r) => this.matches(r));
        this.fake.tables[this.table] = rows.filter((r) => !this.matches(r));
        this.fake.writes.push({ op: "delete", table: this.table });
        return { data: this.returning ? hit.map((r) => this.project(r)) : null, error: null };
      }
      default: {
        let hit = rows.filter((r) => this.matches(r));
        for (const { col, ascending } of [...this.orderBy].reverse()) {
          hit = [...hit].sort((a, b) => (ascending ? 1 : -1) * compare(a[col], b[col]));
        }
        if (this.rangeFrom !== null && this.rangeTo !== null) hit = hit.slice(this.rangeFrom, this.rangeTo + 1);
        if (this.limitN !== null) hit = hit.slice(0, this.limitN);
        hit = hit.slice(0, this.fake.maxRows);
        return { data: hit.map((r) => this.project(r)), error: null };
      }
    }
  }
}
