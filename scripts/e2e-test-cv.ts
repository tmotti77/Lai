/**
 * Ad-hoc end-to-end test of the CV pipeline against a running dev server.
 *
 * Uploads each fixture, calls extract, prints the full extraction.
 * Maintains the co_anon cookie across requests so the same anonymous
 * user owns the upload and the extract.
 *
 * Run with:  npx tsx scripts/e2e-test-cv.ts [path-to-pdf]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const BASE = process.env.CV_TEST_BASE_URL ?? "http://localhost:3000";

const cookieJar = new Map<string, string>();

function cookieHeader(): string {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function captureCookies(res: Response) {
  // Node fetch flattens multiple Set-Cookie headers into a single comma-joined
  // value. Split conservatively on ", " followed by a token=, then keep just
  // name=value (drop attributes like Path, HttpOnly, Expires).
  const raw = res.headers.get("set-cookie");
  if (!raw) return;
  for (const piece of raw.split(/,\s*(?=[^=;,\s]+=)/)) {
    const [pair] = piece.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function uploadFixture(path: string) {
  const buffer = readFileSync(path);
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, basename(path));

  console.log(`\n--- Upload: ${path} (${buffer.length} bytes) ---`);
  const headers: HeadersInit = {};
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}/api/cv/upload`, { method: "POST", body: form, headers });
  captureCookies(res);
  const text = await res.text();
  console.log(`status: ${res.status}`);
  try {
    const json = JSON.parse(text);
    console.log("response:", json);
    return res.ok ? (json as { id: string; truncated?: boolean }) : null;
  } catch {
    console.log("body (not JSON):", text);
    return null;
  }
}

async function extract(cvUploadId: string) {
  console.log(`\n--- Extract: ${cvUploadId} ---`);
  const res = await fetch(`${BASE}/api/cv/extract`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ cv_upload_id: cvUploadId }),
  });
  captureCookies(res);
  console.log(`status: ${res.status}`);
  if (!res.ok) {
    console.log("body:", await res.text());
    return;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
  }
  acc += decoder.decode();

  console.log("--- raw stream length:", acc.length, "chars ---");
  console.log("--- last 4000 chars of stream ---");
  console.log(acc.slice(-4000));
}

const fixtures = process.argv.slice(2);
if (fixtures.length === 0) {
  fixtures.push(
    "scripts/test-cv-sparse.pdf",
    "scripts/test-cv-teacher.pdf",
    "scripts/test-cv-blank.pdf",
  );
}

(async () => {
  for (const f of fixtures) {
    const upload = await uploadFixture(f);
    if (upload) await extract(upload.id);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
