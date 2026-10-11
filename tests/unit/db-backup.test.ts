import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const BACKUP = join(root, "scripts/db-backup.sh");
const RESTORE = join(root, "scripts/db-restore.sh");
const WORKFLOW = join(root, ".github/workflows/db-backup.yml");
const PASS = "s3cret-Passphrase-XYZ";
const STUB_URL = "postgresql://user:pw@stub.invalid:5432/postgres";

function stubs() {
  const dir = mkdtempSync(join(tmpdir(), "dbstub-"));
  const log = join(dir, "calls.log");
  const mk = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(p, 0o755);
  };
  // pg_dump: write fake archive to --file=
  mk("pg_dump", `for a in "$@"; do case "$a" in --file=*) echo FAKEDUMP > "\${a#--file=}";; esac; done`);
  mk("pg_restore", `exit 0`);
  // gpg: write to --output target
  mk("gpg", `out=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done; cat <&3 >/dev/null 2>&1 || true; [ -n "$out" ] && echo ENC > "$out"; exit 0`);
  return { dir, log };
}

function run(script: string, env: Record<string, string>, args: string[] = []) {
  const s = stubs();
  const out = mkdtempSync(join(tmpdir(), "dbout-"));
  const r = spawnSync("bash", [script, ...args.map((a) => a.replace("$OUT", out))], {
    env: { PATH: `${s.dir}:/usr/bin:/bin`, HOME: tmpdir(), ...env },
    encoding: "utf8",
  });
  const calls = existsSync(s.log) ? readFileSync(s.log, "utf8") : "";
  return { ...r, calls, out };
}

describe("db-backup.sh", () => {
  it("fails clearly without SUPABASE_DB_URL and never calls pg_dump", () => {
    const r = run(BACKUP, { BACKUP_PASSPHRASE: PASS }, ["$OUT"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/SUPABASE_DB_URL/);
    expect(r.calls).not.toMatch(/pg_dump/);
  });

  it("fails clearly without BACKUP_PASSPHRASE", () => {
    const r = run(BACKUP, { SUPABASE_DB_URL: STUB_URL }, ["$OUT"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/BACKUP_PASSPHRASE/);
    expect(r.calls).not.toMatch(/pg_dump/);
  });

  it("happy path: one encrypted dump, correct flags, passphrase never leaked", () => {
    const r = run(BACKUP, { SUPABASE_DB_URL: STUB_URL, BACKUP_PASSPHRASE: PASS }, ["$OUT"]);
    expect(r.stderr + r.stdout).not.toContain(PASS);
    expect(r.status).toBe(0);
    const files = readdirSync(r.out);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^careeros-db-.*\.dump\.gpg$/);
    expect(r.calls).toMatch(/pg_dump .*--format=custom/);
    expect(r.calls).toMatch(/--no-owner/);
    expect(r.calls).toMatch(/--no-privileges/);
    for (const s of ["public", "auth", "storage"]) expect(r.calls).toMatch(new RegExp(`--schema=${s}`));
    expect(r.calls).toMatch(/gpg .*--symmetric/);
    expect(r.calls).toMatch(/--cipher-algo AES256/);
    expect(r.calls).not.toContain(PASS);
  });
});

describe("db-restore.sh", () => {
  const dump = () => {
    const d = mkdtempSync(join(tmpdir(), "dump-"));
    const f = join(d, "x.dump.gpg");
    writeFileSync(f, "ENC");
    return f;
  };

  it("fails clearly without TARGET_DB_URL", () => {
    const r = run(RESTORE, { BACKUP_PASSPHRASE: PASS }, [dump()]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/TARGET_DB_URL/);
  });

  it("fails clearly without BACKUP_PASSPHRASE", () => {
    const r = run(RESTORE, { TARGET_DB_URL: STUB_URL }, [dump()]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/BACKUP_PASSPHRASE/);
  });

  for (const url of [
    "postgresql://postgres:pw@db.wqswamtcppjmkwykukjp.supabase.co:5432/postgres",
    "postgresql://postgres.WQSWAMTCPPJMKWYKUKJP:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  ]) {
    it(`refuses the career-os prod project (${url.slice(0, 40)}…)`, () => {
      const r = run(RESTORE, { TARGET_DB_URL: url, BACKUP_PASSPHRASE: PASS }, [dump()]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Refusing/);
      expect(r.calls).not.toMatch(/gpg|pg_restore/);
    });
  }

  it("allows prod only with I_KNOW_THIS_IS_PROD=1", () => {
    const url = "postgresql://postgres:pw@db.wqswamtcppjmkwykukjp.supabase.co:5432/postgres";
    const r = run(RESTORE, { TARGET_DB_URL: url, BACKUP_PASSPHRASE: PASS, I_KNOW_THIS_IS_PROD: "1" }, [dump()]);
    expect(r.status).toBe(0);
    expect(r.calls).toMatch(/pg_restore/);
  });

  it("refuses when TARGET_DB_URL equals SUPABASE_DB_URL", () => {
    const r = run(RESTORE, { TARGET_DB_URL: STUB_URL, SUPABASE_DB_URL: STUB_URL, BACKUP_PASSPHRASE: PASS }, [dump()]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Refusing/);
  });

  it("restores into a non-prod target", () => {
    const r = run(RESTORE, { TARGET_DB_URL: STUB_URL, BACKUP_PASSPHRASE: PASS }, [dump()]);
    expect(r.status).toBe(0);
    expect(r.calls).toMatch(/pg_restore .*--no-owner/);
    expect(r.stderr + r.stdout + r.calls).not.toContain(PASS);
  });
});

describe("no hard-coded secrets", () => {
  for (const f of [BACKUP, RESTORE, WORKFLOW]) {
    it(f.replace(root + "/", ""), () => {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/postgres(ql)?:\/\//);
      expect(s).not.toMatch(/password=/i);
      expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
      expect(s).not.toMatch(/sb_secret_|sbp_/);
      expect(s).not.toMatch(/PGPASSWORD=/);
    });
  }
});

describe("db-backup workflow", () => {
  const y = () => readFileSync(WORKFLOW, "utf8");
  it("runs weekly and on demand", () => {
    expect(y()).toMatch(/schedule:\s*\n\s*- cron: ["']0 2 \* \* 0["']/);
    expect(y()).toMatch(/workflow_dispatch/);
  });
  it("has minimal permissions", () => {
    expect(y()).toMatch(/^permissions:\s*\n\s+contents: read\s*\n(?!\s+\w+:)/m);
  });
  it("uses pg client 17, 90-day retention and secrets only via secrets.*", () => {
    expect(y()).toMatch(/postgresql-client-17/);
    expect(y()).toMatch(/retention-days: 90/);
    expect(y()).toMatch(/\$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
    expect(y()).toMatch(/\$\{\{ secrets\.BACKUP_PASSPHRASE \}\}/);
  });
});
