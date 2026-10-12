"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { he } from "@/lib/i18n/he";
import { DELETE_CONFIRMATION } from "@/lib/privacy/constants";
import { deleteErrorMessage } from "./messages";
import { navigate } from "./navigate";

/**
 * How long the dialog stays non-dismissable waiting on DELETE /api/me: the route's
 * maxDuration (30 s) plus margin. After that the outcome is unknown, not failed.
 */
export const DELETE_PENDING_TIMEOUT_MS = 45_000;

type Phase = "idle" | "deleting" | "error" | "unknown";

const ITEM_KEYS = ["conversations", "assessments", "cv", "recommendations", "plans", "interviews", "feedback"] as const;

interface Props {
  isAnonymous: boolean;
  /** Shared with the panel: an export in flight blocks deletion, and vice versa. */
  exporting: boolean;
  onExportAction: () => void | Promise<void>;
  pendingTimeoutMs?: number;
}

export function DeleteAccountDialog({
  isAnonymous,
  exporting,
  onExportAction,
  pendingTimeoutMs = DELETE_PENDING_TIMEOUT_MS,
}: Props) {
  const d = he.settings.delete;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped per request and on close, so a stale timeout or error can't touch a newer state.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const deleting = phase === "deleting";
  const canConfirm = typed.trim() === d.confirmWord && !deleting && !exporting;
  const items = isAnonymous ? ITEM_KEYS : [...ITEM_KEYS, "account" as const];

  function handleOpenChange(next: boolean) {
    if (deleting) return;
    if (!next) {
      attempt.current++;
      clearTimeout(timer.current);
      setTyped("");
      setPhase("idle");
      setErrorMessage(null);
    }
    setOpen(next);
  }

  async function submit() {
    if (!canConfirm) return;
    const id = ++attempt.current;
    const current = () => attempt.current === id;
    setPhase("deleting");
    setErrorMessage(null);
    clearTimeout(timer.current);
    // The request is not aborted: the server may still finish the deletion.
    timer.current = setTimeout(() => {
      if (!current()) return;
      setPhase("unknown");
      setErrorMessage(d.errors.unknown);
    }, pendingTimeoutMs);

    let res: Response;
    try {
      res = await fetch("/api/me", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }),
      });
    } catch {
      if (!current()) return;
      clearTimeout(timer.current);
      setPhase("error");
      setErrorMessage(d.errors.generic);
      return;
    }

    if (res.ok) {
      // Navigate even if the user closed the dialog meanwhile: the data is gone.
      // Only an explicit complete:true earns the "everything deleted" notice.
      const body = (await res.json().catch(() => ({}))) as { complete?: boolean };
      clearTimeout(timer.current);
      if (current()) setPhase("deleting");
      navigate(body.complete === true ? "/?deleted=1" : "/?deleted=partial");
      return;
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!current()) return;
    clearTimeout(timer.current);
    setPhase("error");
    setErrorMessage(deleteErrorMessage(res.status, body.error));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive">{d.openButton}</Button>
      </DialogTrigger>
      <DialogContent
        hideClose={deleting}
        className="text-start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (deleting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (deleting) e.preventDefault();
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>{d.dialogTitle}</DialogTitle>
          <DialogDescription>{d.dialogDescription}</DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 ps-5 text-sm">
          {items.map((key) => (
            <li key={key}>{d.items[key]}</li>
          ))}
        </ul>

        <p className="text-sm text-muted-foreground">
          {d.exportFirst}{" "}
          <button
            type="button"
            onClick={() => {
              if (!deleting && !exporting) void onExportAction();
            }}
            disabled={deleting || exporting}
            aria-busy={exporting}
            className="rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {d.exportFirstButton}
          </button>
        </p>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <label id="delete-confirm-label" htmlFor="delete-confirm" className="text-sm font-medium">
              {d.typeToConfirm}
            </label>
            <Input
              id="delete-confirm"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              dir="rtl"
              disabled={deleting}
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <span>{errorMessage}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void submit()}>
                {d.retry}
              </Button>
            </div>
          )}

          {/* DOM order = Tab order = visual order: cancel first (inline start in RTL). */}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={deleting} onClick={() => handleOpenChange(false)}>
              {d.cancel}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={!canConfirm}
              aria-describedby="delete-confirm-label"
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {deleting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  {d.deleting}
                </>
              ) : (
                d.confirmButton
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
