import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "abc123def456abc123def456abc12345"),
  flush: vi.fn().mockResolvedValue(true),
}));

import { POST } from "@/app/api/_internal/sentry-test/route";
import { captureException, flush } from "@sentry/nextjs";

beforeEach(() => vi.clearAllMocks());

function makeReq(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("http://test/api/_internal/sentry-test", {
    method: "POST",
    headers,
  });
}

describe("POST /api/_internal/sentry-test", () => {
  it("returns 401 without Bearer token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    const res = await POST(makeReq(null) as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    const res = await POST(makeReq("wrong-token-length-different-from-expected") as never);
    expect(res.status).toBe(401);
  });

  it("returns 503 when ADMIN_EXPORT_TOKEN env not set", async () => {
    delete process.env.ADMIN_EXPORT_TOKEN;
    const res = await POST(makeReq("anything") as never);
    expect(res.status).toBe(503);
  });

  it("captures + flushes and returns eventId on valid token", async () => {
    process.env.ADMIN_EXPORT_TOKEN = "expected-token-value";
    const res = await POST(makeReq("expected-token-value") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eventId).toBe("abc123def456abc123def456abc12345");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(5000);
  });
});
