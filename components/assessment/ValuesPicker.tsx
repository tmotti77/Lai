"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { VALUES_OPTIONS } from "@/lib/assessment/values/options";
import { Button } from "@/components/ui/button";
import { he } from "@/lib/i18n/he";
import { toast } from "sonner";

const PICK_TARGET = 5;
const RANK_TARGET = 3;

export function ValuesPicker() {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "rank">("pick");
  const [picked, setPicked] = useState<string[]>([]);
  const [ranked, setRanked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const togglePick = (id: string) => {
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < PICK_TARGET
        ? [...prev, id]
        : prev,
    );
  };

  const toggleRank = (id: string) => {
    setRanked((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < RANK_TARGET
        ? [...prev, id]
        : prev,
    );
  };

  const goToRank = () => {
    if (picked.length !== PICK_TARGET) {
      toast.error(he.assessment.values.mustPickFive);
      return;
    }
    setStep("rank");
  };

  const onSubmit = async () => {
    if (ranked.length !== RANK_TARGET) {
      toast.error(he.assessment.values.mustRankThree);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "values", responses: { picked, ranked } }),
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

  if (step === "pick") {
    return (
      <>
        <p className="text-base">{he.assessment.values.pickInstruction} ({picked.length}/{PICK_TARGET})</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VALUES_OPTIONS.map((opt) => {
            const selected = picked.includes(opt.id);
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => togglePick(opt.id)}
                  className={`min-h-11 w-full rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">{opt.label_he}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{opt.description_he}</div>
                </button>
              </li>
            );
          })}
        </ul>
        <Button onClick={goToRank} disabled={picked.length !== PICK_TARGET} size="lg">
          {he.assessment.common.next}
        </Button>
      </>
    );
  }

  // rank step
  const pickedOptions = picked
    .map((id) => VALUES_OPTIONS.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => o != null);

  return (
    <>
      <p className="text-base">{he.assessment.values.rankInstruction} ({ranked.length}/{RANK_TARGET})</p>
      <ol className="space-y-3">
        {pickedOptions.map((opt) => {
          const rankIndex = ranked.indexOf(opt.id);
          const selected = rankIndex >= 0;
          return (
            <li key={opt.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => toggleRank(opt.id)}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                }`}
              >
                <span className="font-medium">{opt.label_he}</span>
                {selected && (
                  <span className="ms-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">
                    {rankIndex + 1}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep("pick")}>
          {he.assessment.common.back}
        </Button>
        <Button onClick={onSubmit} disabled={ranked.length !== RANK_TARGET || submitting} size="lg" className="flex-1">
          {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
        </Button>
      </div>
    </>
  );
}
