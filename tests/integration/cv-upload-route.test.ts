import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FakeSupabase as FakeSupabaseT } from "../mocks/fake-supabase";

// The upload route stores the file before it inserts the cv_uploads row. These tests pin
// that a failed insert can't leave an orphan object, and that uploads are refused while
// an account deletion holds its lock (#51).
const h = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabaseT,
  userId: "",
  createCvUpload: vi.fn(),
  setExtraction: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => h.fake.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));
vi.mock("@/lib/anonymous", () => ({ getOrCreateAnonymousUserId: async () => h.userId }));
vi.mock("@/lib/consent", () => ({ requireConsent: vi.fn(async () => {}), NoConsentError: class extends Error {} }));
vi.mock("@/lib/cv/parse", () => ({ extractText: vi.fn(async () => ({ text: "cv text", truncated: false })) }));
vi.mock("@/lib/db/cv", () => ({ createCvUpload: h.createCvUpload, setExtraction: h.setExtraction }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException, captureMessage: vi.fn() }));

import { POST } from "@/app/api/cv/upload/route";
import { FakeSupabase } from "../mocks/fake-supabase";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const BUCKET = "cv-uploads";

function uploadRequest() {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([37, 80, 68, 70])], "cv.pdf", { type: "application/pdf" }));
  return new Request("http://localhost:3000/api/cv/upload", { method: "POST", body: fd });
}

function lockAgo(ms: number) {
  h.fake.rows("users").find((r) => r.id === h.userId)!.deletion_requested_at = new Date(NOW.getTime() - ms).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.fake = new FakeSupabase();
  h.userId = h.fake.insertRow("users", { is_anonymous: true }).id as string;
  h.createCvUpload.mockReset().mockResolvedValue({ id: "cv-1" });
  h.setExtraction.mockReset().mockResolvedValue(undefined);
  h.captureException.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/cv/upload — storage consistency", () => {
  it("uploads the object and returns the row id", async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "cv-1", truncated: false });
    expect(h.fake.objectPaths(BUCKET)).toHaveLength(1);
    expect(h.fake.objectPaths(BUCKET)[0]).toMatch(new RegExp(`^${h.userId}/[0-9a-f-]+\\.pdf$`));
  });

  it("removes the uploaded object when the cv_uploads insert fails", async () => {
    h.createCvUpload.mockRejectedValue(new Error("insert or update violates foreign key constraint"));
    const res = await POST(uploadRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db_failed");
    expect(h.fake.objectPaths(BUCKET)).toEqual([]);
    const [[, uploadedPath]] = h.fake.callsOf("storage.upload");
    expect(h.fake.callsOf("storage.remove")).toEqual([[BUCKET, [uploadedPath]]]);
  });

  it("reports a failed orphan cleanup to Sentry and still answers 500", async () => {
    h.createCvUpload.mockRejectedValue(new Error("db down"));
    h.fake.failNext("storage.remove");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(uploadRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db_failed");
    expect(h.captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: { context: "cv_upload", stage: "orphan_cleanup" } }),
    );
  });
});

describe("POST /api/cv/upload — account deletion lock", () => {
  it("refuses the upload while a deletion holds the lock", async () => {
    lockAgo(30_000);
    const res = await POST(uploadRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "deletion_in_progress" });
    expect(h.fake.callsOf("storage.upload")).toEqual([]);
    expect(h.createCvUpload).not.toHaveBeenCalled();
  });

  it("ignores a stale lock older than the TTL", async () => {
    lockAgo(3 * 60_000);
    expect((await POST(uploadRequest())).status).toBe(200);
  });
});
