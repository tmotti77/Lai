"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { he } from "@/lib/i18n/he";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export function InputBar({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-border bg-background px-4 py-3"
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={he.chat.placeholder}
        rows={2}
        className="min-h-[44px] flex-1 resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e as unknown as FormEvent);
          }
        }}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        {disabled ? he.chat.sending : he.chat.send}
      </Button>
    </form>
  );
}
