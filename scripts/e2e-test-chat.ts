/**
 * Ad-hoc 2-turn chat test to investigate the prompt cache reads NULL claim.
 *
 * Sends two consecutive messages with cookie persistence, then captures the
 * server-side log lines that record cacheRead / cacheWrite per turn.
 *
 * Run with:  npx tsx scripts/e2e-test-chat.ts
 * Requires:  npm run dev running on localhost:3000
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.CHAT_TEST_BASE_URL ?? "http://localhost:3000";

const cookieJar = new Map<string, string>();
function cookieHeader(): string {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
function captureCookies(res: Response) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return;
  for (const piece of raw.split(/,\s*(?=[^=;,\s]+=)/)) {
    const [pair] = piece.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

let conversationId: string | undefined;

async function sendTurn(text: string, turnLabel: string): Promise<void> {
  console.log(`\n--- ${turnLabel}: ${text.slice(0, 60)}... ---`);
  const headers: HeadersInit = { "content-type": "application/json" };
  const ck = cookieHeader();
  if (ck) headers.cookie = ck;

  const messages = [
    {
      id: crypto.randomUUID(),
      role: "user" as const,
      parts: [{ type: "text", text }],
    },
  ];

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      conversationId,
    }),
  });
  captureCookies(res);

  const ridHdr = res.headers.get("x-conversation-id");
  if (ridHdr) conversationId = ridHdr;
  const stage = res.headers.get("x-stage");
  console.log(`status: ${res.status}  conversationId: ${conversationId}  stage: ${stage}`);

  if (!res.ok) {
    console.log("body:", await res.text());
    return;
  }

  // Drain the stream
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
  }
  acc += decoder.decode();
  console.log(`stream length: ${acc.length} chars`);
}

(async () => {
  console.log("Turn 1 will populate the cache; turn 2 should hit it.");
  console.log("Watch the dev server console for [chat] turn finished log lines.\n");

  await sendTurn(
    "שלום. אני בן 22, סיימתי שירות צבאי לפני חודש, ולא יודע מה לעשות הלאה.",
    "TURN 1 (cold)",
  );
  await sleep(2000);
  await sendTurn(
    "אני מתעניין בתחום הטכנולוגי אבל גם בעיצוב. עוד לא החלטתי.",
    "TURN 2 (should hit cache)",
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
