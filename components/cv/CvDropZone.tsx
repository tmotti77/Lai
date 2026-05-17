"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import {
  ACCEPTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/cv/types";

const ACCEPTED_SET = new Set<string>(ACCEPTED_MIME_TYPES);

export function CvDropZone({ onUpload }: { onUpload: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const validate = useCallback((f: File): string | null => {
    if (f.size === 0) return he.cv.errors.emptyText;
    if (f.size > MAX_FILE_SIZE_BYTES) return he.cv.errors.fileTooLarge;
    if (!ACCEPTED_SET.has(f.type)) return he.cv.errors.unsupportedType;
    return null;
  }, []);

  const pickFile = useCallback(
    (f: File) => {
      const err = validate(f);
      if (err) {
        toast.error(err);
        return;
      }
      setFile(f);
    },
    [validate],
  );

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  };

  const canStart = file !== null && consent;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-12">
      <header className="space-y-2 text-right">
        <h1 className="text-3xl font-bold tracking-tight">{he.cv.hero.title}</h1>
        <p className="text-base text-muted-foreground">{he.cv.hero.subtitle}</p>
      </header>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-label={he.cv.upload.pickFile}
        className={[
          "group block w-full rounded-2xl border-2 border-dashed p-10 text-center transition-[transform,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          dragOver
            ? "scale-[1.01] border-primary bg-primary/5"
            : "border-border bg-card hover:border-primary/50 hover:bg-accent/5",
        ].join(" ")}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7" aria-hidden>
            <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="mt-4 text-base font-medium">{he.cv.upload.dropHere}</div>
        <div className="mt-1 text-sm text-muted-foreground">{he.cv.upload.orClick}</div>
        <div className="mt-3 text-xs text-muted-foreground">{he.cv.upload.formats}</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={onInput}
      />

      {file && (
        <div className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden>
              <path d="M14 3v4a1 1 0 001 1h4M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8L14 3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)}MB
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
            {he.cv.upload.remove}
          </Button>
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
        />
        <span className="text-muted-foreground">{he.cv.upload.consent}</span>
      </label>

      <Button
        size="lg"
        disabled={!canStart}
        onClick={() => file && onUpload(file)}
        className="w-full"
      >
        {he.cv.upload.start}
      </Button>
    </div>
  );
}
