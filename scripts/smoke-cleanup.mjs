#!/usr/bin/env node
// scripts/smoke-cleanup.mjs
// Async sweeper: deletes anonymous users older than 24h with no chat activity.
// Run periodically (e.g., once a day) to catch residue if inline smoke cleanup fails.
// Safe to run anytime — only touches anonymous users with no conversations.

import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values: args } = parseArgs({
  options: {
    "supabase-url":             { type: "string" },
    "supabase-service-role-key":{ type: "string" },
    "older-than-hours":         { type: "string", default: "24" },
    "dry-run":                  { type: "boolean", default: false },
  },
});

if (!args["supabase-url"] || !args["supabase-service-role-key"]) {
  console.error("smoke-cleanup: missing --supabase-url and/or --supabase-service-role-key");
  process.exit(2);
}

const svc = createClient(args["supabase-url"], args["supabase-service-role-key"], {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cutoffMs = Date.now() - parseInt(args["older-than-hours"], 10) * 60 * 60 * 1000;
const cutoffIso = new Date(cutoffMs).toISOString();

// Find anonymous users older than the cutoff with no conversations.
// "No chat activity" = no row in conversations referencing this user.
const { data: candidates, error } = await svc
  .from("users")
  .select("id, created_at, conversations!left(id)")
  .eq("is_anonymous", true)
  .lt("created_at", cutoffIso)
  .limit(500);

if (error) {
  console.error("smoke-cleanup: query failed", error.message);
  process.exit(1);
}

const stale = (candidates ?? []).filter((u) => !u.conversations || u.conversations.length === 0);

console.log(`smoke-cleanup: cutoff=${cutoffIso} candidates=${candidates?.length ?? 0} stale=${stale.length}`);

if (args["dry-run"]) {
  console.log(`smoke-cleanup: dry-run, no deletions`);
  process.exit(0);
}

let deleted = 0;
for (const u of stale) {
  const { error: delErr } = await svc.from("users").delete().eq("id", u.id);
  if (delErr) {
    console.error(`smoke-cleanup: delete failed for ${u.id}`, delErr.message);
  } else {
    deleted++;
  }
}

console.log(`smoke-cleanup: deleted=${deleted}/${stale.length}`);
process.exit(0);
