"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { toast } from "sonner";
import { he } from "@/lib/i18n/he";
import { CvExtractionSchema } from "@/lib/cv/schema";
import type { ExtractedSkill } from "@/lib/cv/types";
import { CvDropZone } from "./CvDropZone";
import { CvReadingState, type PartialOutput } from "./CvReadingState";
import { CvReview } from "./CvReview";
import { CvSuccess } from "./CvSuccess";

type Phase = "idle" | "uploading" | "reading" | "reviewing" | "saving" | "success";

export type InitialCvState = {
  id: string;
  filename: string;
  confirmed: boolean;
  reflectionHe: string;
  taxonomySkills: ExtractedSkill[];
  otherSkills: string[];
};

type ReviewData = {
  cvUploadId: string;
  reflectionHe: string;
  skills: ExtractedSkill[];
  otherSkills: string[];
};

export function CvUploadClient({ initial }: { initial: InitialCvState | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => {
    if (!initial) return "idle";
    if (initial.confirmed) return "success";
    if (initial.reflectionHe || initial.taxonomySkills.length > 0) return "reviewing";
    return "idle";
  });
  const [filename, setFilename] = useState<string | null>(initial?.filename ?? null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(
    initial && !initial.confirmed && (initial.reflectionHe || initial.taxonomySkills.length > 0)
      ? {
          cvUploadId: initial.id,
          reflectionHe: initial.reflectionHe,
          skills: initial.taxonomySkills,
          otherSkills: initial.otherSkills,
        }
      : null,
  );
  const [successData, setSuccessData] = useState<{ count: number; archetype: string } | null>(null);

  const { object, submit, isLoading } = useObject({
    api: "/api/cv/extract",
    schema: CvExtractionSchema,
    onFinish: ({ object: final, error }) => {
      if (error || !final) {
        toast.error(he.cv.errors.extractionFailed);
        setPhase("idle");
        return;
      }
      setReviewData({
        cvUploadId: reviewData?.cvUploadId ?? "",
        reflectionHe: final.reflection_he,
        skills: final.skills,
        otherSkills: final.other_skills ?? [],
      });
      setPhase("reviewing");
    },
    onError: () => {
      toast.error(he.cv.errors.extractionFailed);
      setPhase("idle");
    },
  });

  const handleUpload = async (file: File) => {
    setPhase("uploading");
    setFilename(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cv/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const errorKey = json.error as keyof typeof he.cv.errors | undefined;
        const errorMsg =
          errorKey && errorKey in he.cv.errors
            ? he.cv.errors[errorKey]
            : he.cv.errors.uploadFailed;
        toast.error(errorMsg);
        setPhase("idle");
        return;
      }
      const { id } = (await res.json()) as { id: string };
      setReviewData({ cvUploadId: id, reflectionHe: "", skills: [], otherSkills: [] });
      setPhase("reading");
      submit({ cv_upload_id: id });
    } catch {
      toast.error(he.cv.errors.uploadFailed);
      setPhase("idle");
    }
  };

  const handleConfirm = async (skillIds: string[]) => {
    if (!reviewData) return;
    setPhase("saving");
    try {
      const res = await fetch("/api/cv/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cv_upload_id: reviewData.cvUploadId,
          skill_ids: skillIds,
        }),
      });
      if (!res.ok) {
        toast.error(he.cv.errors.saveFailed);
        setPhase("reviewing");
        return;
      }
      const { skill_count } = (await res.json()) as { skill_count: number };

      // Compute archetype from confirmed skill categories
      const { inferArchetype } = await import("@/lib/cv/archetype");
      const { default: taxonomy } = await import("@/content/skills/taxonomy.json");
      const taxMap = new Map(
        taxonomy.skills.map((s: { id: string; category: string }) => [s.id, s.category]),
      );
      const categories = skillIds
        .filter((id) => !id.startsWith("other:"))
        .map((id) => taxMap.get(id))
        .filter((c): c is string => Boolean(c));
      const archetype = inferArchetype(categories);

      setSuccessData({ count: skill_count, archetype });
      setPhase("success");
    } catch {
      toast.error(he.cv.errors.saveFailed);
      setPhase("reviewing");
    }
  };

  const handleViewRecommendations = async () => {
    try {
      await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
    } catch {
      // Recompute is best-effort; navigate anyway
    }
    router.push("/recommendations");
  };

  const handleReUpload = () => {
    setPhase("idle");
    setFilename(null);
    setReviewData(null);
    setSuccessData(null);
  };

  if (phase === "success" && (successData || initial?.confirmed)) {
    return (
      <CvSuccess
        skillCount={successData?.count ?? initial?.taxonomySkills.length ?? 0}
        archetype={successData?.archetype ?? "generalist"}
        onViewRecommendations={handleViewRecommendations}
        onReUpload={handleReUpload}
      />
    );
  }

  if (phase === "reviewing" || phase === "saving") {
    if (!reviewData) return null;
    return (
      <CvReview
        reflectionHe={reviewData.reflectionHe}
        skills={reviewData.skills}
        otherSkills={reviewData.otherSkills}
        saving={phase === "saving"}
        onSave={handleConfirm}
        onCancel={handleReUpload}
      />
    );
  }

  if (phase === "reading" || phase === "uploading") {
    return (
      <CvReadingState
        filename={filename ?? ""}
        partial={(object ?? null) as PartialOutput | null}
        isLoading={isLoading || phase === "uploading"}
        isUploading={phase === "uploading"}
      />
    );
  }

  return <CvDropZone onUpload={handleUpload} />;
}
