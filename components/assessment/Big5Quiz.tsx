"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BIG5_ITEMS } from "@/lib/assessment/big5/items";
import { LikertRow } from "./LikertRow";
import { ProgressIndicator } from "./ProgressIndicator";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { toast } from "sonner";

export function Big5Quiz() {
  const router = useRouter();
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const total = BIG5_ITEMS.length;
  const answered = Object.keys(responses).length;
  const allAnswered = answered === total;

  const onSubmit = async () => {
    if (!allAnswered) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "big5", responses }),
      });
      if (!res.ok) {
        toast.error(he.assessment.common.error);
        setSubmitError(he.assessment.common.submitError);
        setSubmitting(false);
        return;
      }
      toast.success(he.assessment.common.submitted);
      router.push("/assessment");
    } catch {
      toast.error(he.assessment.common.error);
      setSubmitError(he.assessment.common.submitError);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b bg-background/80 px-4 py-3 backdrop-blur">
        <ProgressIndicator current={answered} total={total} />
      </div>
      {BIG5_ITEMS.map((item) => (
        <LikertRow
          key={item.id}
          itemId={item.id}
          text={item.text_he}
          value={responses[item.id]}
          onChange={(n) => setResponses((prev) => ({ ...prev, [item.id]: n }))}
        />
      ))}
      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}
      <Button type="button" size="lg" disabled={!allAnswered || submitting} onClick={onSubmit}>
        {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
      </Button>
    </>
  );
}
