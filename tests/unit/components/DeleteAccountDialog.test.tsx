/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { he } from "@/lib/i18n/he";
import { DELETE_CONFIRMATION } from "@/lib/privacy/constants";

// #51 part 2, plan §4.1 + critique #3 (partial success), #4 (export race), #5 (focus
// return), #6 (bounded pending state).
const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/components/settings/navigate", () => ({ navigate: h.navigate }));

const { DeleteAccountDialog } = await import("@/components/settings/DeleteAccountDialog");

const d = he.settings.delete;
const fetchMock = vi.fn();

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() };
}

function setup(props: Partial<React.ComponentProps<typeof DeleteAccountDialog>> = {}) {
  const onExportAction = vi.fn();
  render(<DeleteAccountDialog isAnonymous={false} exporting={false} onExportAction={onExportAction} {...props} />);
  return { onExportAction };
}

const trigger = () => screen.getByRole("button", { name: d.openButton });
const open = () => fireEvent.click(trigger());
const input = () => screen.getByLabelText(d.typeToConfirm);
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const confirmBtn = () =>
  screen.getByRole("button", { name: new RegExp(`^(${esc(d.confirmButton)}|${esc(d.deleting)})$`) });
const cancelBtn = () => screen.getByRole("button", { name: d.cancel });
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const dialogOpen = () => screen.queryByRole("dialog") !== null;
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

async function confirmDelete() {
  open();
  type(d.confirmWord);
  fireEvent.click(confirmBtn());
}

beforeEach(() => {
  fetchMock.mockReset();
  h.navigate.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeleteAccountDialog: typed confirmation", () => {
  it("focuses the input on open; confirm starts aria-disabled and does nothing", async () => {
    setup();
    open();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    expect(confirmBtn()).not.toBeDisabled(); // focusable and announced
    fireEvent.click(confirmBtn());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["מח", "true"],
    ["delete", "true"],
    [DELETE_CONFIRMATION, "true"],
    [` ${he.settings.delete.confirmWord} `, "false"],
    [he.settings.delete.confirmWord, "false"],
  ])("typing %j → aria-disabled=%s", (value, disabled) => {
    setup();
    open();
    type(value);
    expect(confirmBtn()).toHaveAttribute("aria-disabled", disabled);
  });

  it("Enter in the input does not submit while unconfirmed", () => {
    setup();
    open();
    type("מח");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.submit(input());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends DELETE /api/me with the wire token and a JSON content-type", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    setup();
    await confirmDelete();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ confirmation: DELETE_CONFIRMATION });
  });

  it("lists the account item only for signed-in users", () => {
    setup({ isAnonymous: false });
    open();
    expect(screen.getByText(d.items.account)).toBeInTheDocument();
    cleanup();
    setup({ isAnonymous: true });
    open();
    expect(screen.queryByText(d.items.account)).toBeNull();
    expect(screen.getByText(d.items.conversations)).toBeInTheDocument();
  });
});

describe("DeleteAccountDialog: pending state", () => {
  it("is non-dismissable: Escape and Cancel do nothing, the close X is gone", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    setup();
    open();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    type(d.confirmWord);
    fireEvent.click(confirmBtn());

    await waitFor(() => expect(confirmBtn()).toHaveTextContent(d.deleting));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(cancelBtn()).toBeDisabled();
    escape();
    fireEvent.click(cancelBtn());
    expect(dialogOpen()).toBe(true);
    // A second click can't double-submit.
    fireEvent.click(confirmBtn());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks export while deleting", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { onExportAction } = setup();
    await confirmDelete();
    const exportBtn = screen.getByRole("button", { name: d.exportFirstButton });
    await waitFor(() => expect(exportBtn).toBeDisabled());
    fireEvent.click(exportBtn);
    expect(onExportAction).not.toHaveBeenCalled();
  });

  it("times out into an 'outcome unknown' state that can be dismissed and retried", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    setup({ pendingTimeoutMs: 30 });
    await confirmDelete();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(d.errors.unknown);
    expect(cancelBtn()).not.toBeDisabled();
    expect(screen.getByRole("button", { name: d.retry })).toBeInTheDocument();
    escape();
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("a late 200 after the timeout still navigates (the deletion happened)", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    setup({ pendingTimeoutMs: 30 });
    await confirmDelete();
    await screen.findByRole("alert");
    resolve(res(200, { deleted: true, complete: true, report: {} }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/?deleted=1"));
  });
});

describe("DeleteAccountDialog: responses", () => {
  it("200 complete:true → /?deleted=1", async () => {
    fetchMock.mockResolvedValue(res(200, { deleted: true, complete: true, report: {} }));
    setup();
    await confirmDelete();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/?deleted=1"));
  });

  it("200 complete:false → /?deleted=partial, no retry offered", async () => {
    fetchMock.mockResolvedValue(res(200, { deleted: true, complete: false, report: {} }));
    setup();
    await confirmDelete();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/?deleted=partial"));
    expect(screen.queryByRole("button", { name: d.retry })).toBeNull();
  });

  it.each([
    [409, { error: "deletion_in_progress", retry_after_s: 30 }, d.errors.inProgress],
    [500, { error: "deletion_incomplete", stage: "db", retryable: true }, d.errors.incomplete],
    [401, { error: "session_expired" }, d.errors.sessionExpired],
    [503, { error: "auth_unavailable" }, d.errors.unavailable],
  ])("%i → persistent alert", async (status, body, text) => {
    fetchMock.mockResolvedValue(res(status, body));
    setup();
    await confirmDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(dialogOpen()).toBe(true);
  });

  it("a rejected fetch → generic; retry re-sends with the same input", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    fetchMock.mockResolvedValueOnce(res(200, { deleted: true, complete: true, report: {} }));
    setup();
    await confirmDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent(d.errors.generic);
    fireEvent.click(screen.getByRole("button", { name: d.retry }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/?deleted=1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirmation: DELETE_CONFIRMATION });
  });
});

describe("DeleteAccountDialog: export interplay", () => {
  it("the inline export button calls onExportAction", () => {
    const { onExportAction } = setup();
    open();
    fireEvent.click(screen.getByRole("button", { name: d.exportFirstButton }));
    expect(onExportAction).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion while an export is pending", () => {
    setup({ exporting: true });
    open();
    type(d.confirmWord);
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirmBtn());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DeleteAccountDialog: focus return and reset", () => {
  it.each([
    ["Cancel", () => fireEvent.click(cancelBtn())],
    ["Escape", escape],
    ["close X", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
  ])("%s returns focus to the trigger", async (_name, dismiss) => {
    setup();
    trigger().focus();
    open();
    await waitFor(() => expect(document.activeElement).toBe(input()));
    dismiss();
    await waitFor(() => expect(dialogOpen()).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("reopening resets the typed confirmation and any error", async () => {
    fetchMock.mockResolvedValue(res(409, { error: "deletion_in_progress" }));
    setup();
    await confirmDelete();
    await screen.findByRole("alert");
    fireEvent.click(cancelBtn());
    await waitFor(() => expect(dialogOpen()).toBe(false));
    open();
    expect(input()).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
  });
});
