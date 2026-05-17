"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { he } from "@/lib/i18n/he";
import { ConstraintsSchema, ENGLISH_LEVELS } from "@/lib/assessment/constraints/schema";
import { toast } from "sonner";

const initialState = {
  location_he: "",
  remote_ok: false,
  time_per_week_hours: "",
  training_budget_nis: "",
  english_level: "",
  risk_tolerance: "5",
  needs_immediate_income: false,
  months_until_income_required: "",
};

export function ConstraintsForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const labels = he.assessment.constraints.fields;
  const englishLabels = he.assessment.constraints.englishLevels;

  const setField = <K extends keyof typeof initialState>(key: K, value: (typeof initialState)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    const payload = ConstraintsSchema.safeParse({
      location_he: form.location_he,
      remote_ok: form.remote_ok,
      time_per_week_hours: form.time_per_week_hours === "" ? undefined : Number(form.time_per_week_hours),
      training_budget_nis: form.training_budget_nis === "" ? undefined : Number(form.training_budget_nis),
      english_level: form.english_level || undefined,
      risk_tolerance: form.risk_tolerance ? Number(form.risk_tolerance) : undefined,
      needs_immediate_income: form.needs_immediate_income,
      months_until_income_required:
        form.months_until_income_required === "" ? undefined : Number(form.months_until_income_required),
    });
    if (!payload.success) {
      toast.error(he.assessment.common.error);
      setSubmitError(he.assessment.common.submitError);
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "constraints", responses: payload.data }),
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={labels.location_he}>
        <Input
          required
          value={form.location_he}
          onChange={(e) => setField("location_he", e.target.value)}
          placeholder="מרכז / צפון / דרום / שרון / ירושלים …"
        />
      </Field>

      <CheckboxField
        label={labels.remote_ok}
        checked={form.remote_ok}
        onChange={(v) => setField("remote_ok", v)}
      />

      <Field label={labels.time_per_week_hours}>
        <Input
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          dir="ltr"
          value={form.time_per_week_hours}
          onChange={(e) => setField("time_per_week_hours", e.target.value)}
        />
      </Field>

      <Field label={labels.training_budget_nis}>
        <Input
          required
          type="number"
          inputMode="numeric"
          min={0}
          max={200_000}
          dir="ltr"
          value={form.training_budget_nis}
          onChange={(e) => setField("training_budget_nis", e.target.value)}
        />
      </Field>

      <Field label={labels.english_level}>
        <select
          value={form.english_level}
          onChange={(e) => setField("english_level", e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">—</option>
          {ENGLISH_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{englishLabels[lvl]}</option>
          ))}
        </select>
      </Field>

      <Field label={labels.risk_tolerance}>
        <input
          type="range"
          min={1}
          max={10}
          value={form.risk_tolerance}
          onChange={(e) => setField("risk_tolerance", e.target.value)}
          className="w-full"
        />
        <div className="text-sm text-muted-foreground">{form.risk_tolerance}/10</div>
      </Field>

      <CheckboxField
        label={labels.needs_immediate_income}
        checked={form.needs_immediate_income}
        onChange={(v) => setField("needs_immediate_income", v)}
      />

      {form.needs_immediate_income && (
        <Field label={labels.months_until_income_required}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            dir="ltr"
            value={form.months_until_income_required}
            onChange={(e) => setField("months_until_income_required", e.target.value)}
          />
        </Field>
      )}

      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? he.assessment.common.submitting : he.assessment.common.submit}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  );
}
