/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { he } from "@/lib/i18n/he";

// #51 part 2, plan §4.2 + critique #4: one export state shared by the panel button and the
// dialog's "export first" button, and deletion blocked while an export is pending.
const h = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/settings/navigate", () => ({ navigate: h.navigate }));

const { DataRightsPanel } = await import("@/components/settings/DataRightsPanel");

const s = he.settings;
const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => "blob:export");
const revokeObjectURL = vi.fn();
let clicked: HTMLAnchorElement[] = [];

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/json" }),
  };
}

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exportBtn = () =>
  screen.getByRole("button", { name: new RegExp(`^(${esc(s.export.button)}|${esc(s.export.loading)})$`) });
const openDelete = () => fireEvent.click(screen.getByRole("button", { name: s.delete.openButton }));
const confirmBtn = () => screen.getByRole("button", { name: s.delete.confirmButton });

beforeEach(() => {
  fetchMock.mockReset();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  h.navigate.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clicked = [];
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DataRightsPanel export", () => {
  it("200: downloads the blob under the content-disposition filename", async () => {
    fetchMock.mockResolvedValue(
      res(200, { a: 1 }, { "content-disposition": 'attachment; filename="careeros-export-2026-10-12.json"' }),
    );
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(s.export.success));
    expect(fetchMock).toHaveBeenCalledWith("/api/me/export", expect.objectContaining({ cache: "no-store" }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("careeros-export-2026-10-12.json");
    expect(clicked[0].getAttribute("href")).toBe("blob:export");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(exportBtn()).not.toBeDisabled();
  });

  it("200 without content-disposition: fallback filename", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toBe("careeros-export.json");
  });

  it.each([
    [429, { error: "rate_limited", retry_after_s: 60 }, s.export.errors.rateLimited.replace("{seconds}", "60")],
    [401, { error: "no_identity" }, s.export.errors.noData],
    [401, { error: "session_expired" }, s.export.errors.sessionExpired],
    [503, { error: "disabled" }, s.export.errors.unavailable],
  ])("%i → toast.error", async (status, body, text) => {
    fetchMock.mockResolvedValue(res(status, body));
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(text));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("429 text contains the seconds", async () => {
    fetchMock.mockResolvedValue(res(429, { error: "rate_limited", retry_after_s: 60 }));
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.toast.error.mock.calls[0][0]).toContain("60");
  });

  it("network failure → generic toast, button re-enabled", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(s.export.errors.generic));
    expect(exportBtn()).not.toBeDisabled();
  });

  it("disabled while exporting; a double click makes one request", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    render(<DataRightsPanel isAnonymous />);
    fireEvent.click(exportBtn());
    fireEvent.click(exportBtn());
    await waitFor(() => expect(exportBtn()).toBeDisabled());
    expect(exportBtn()).toHaveTextContent(s.export.loading);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(res(200, {})));
    await waitFor(() => expect(exportBtn()).not.toBeDisabled());
  });
});

describe("DataRightsPanel delete", () => {
  it("the delete button opens the dialog", () => {
    render(<DataRightsPanel isAnonymous={false} />);
    openDelete();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(s.delete.dialogTitle)).toBeInTheDocument();
  });

  it("an export started from the panel blocks deletion until it settles", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    render(<DataRightsPanel isAnonymous={false} />);
    fireEvent.click(exportBtn());
    openDelete();
    fireEvent.change(screen.getByLabelText(s.delete.typeToConfirm), { target: { value: s.delete.confirmWord } });

    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirmBtn());
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the export

    await act(async () => pending.resolve(res(200, {})));
    await waitFor(() => expect(confirmBtn()).toHaveAttribute("aria-disabled", "false"));
  });

  it("an export started from the dialog shares state with the panel and blocks deletion", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    render(<DataRightsPanel isAnonymous={false} />);
    openDelete();
    fireEvent.change(screen.getByLabelText(s.delete.typeToConfirm), { target: { value: s.delete.confirmWord } });
    fireEvent.click(screen.getByRole("button", { name: s.delete.exportFirstButton }));

    await waitFor(() => expect(confirmBtn()).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByRole("button", { name: s.delete.exportFirstButton })).toBeDisabled();
    fireEvent.click(confirmBtn());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me/export");

    await act(async () => pending.resolve(res(200, {})));
    await waitFor(() => expect(confirmBtn()).toHaveAttribute("aria-disabled", "false"));
  });
});
