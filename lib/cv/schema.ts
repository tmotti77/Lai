import { z } from "zod";

export const CvExtractionSchema = z.object({
  reflection_he: z
    .string()
    .min(20)
    .describe(
      "2-3 sentences in Hebrew reflecting back what stands out about the person. Warm but honest. Quote specific things from the CV.",
    ),
  skills: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "taxonomy id from the provided list, or 'other:<short phrase>' if not in taxonomy",
          ),
        confidence: z.number().min(0).max(1),
        evidence: z.string().describe("the exact phrase from the CV that supports this skill"),
      }),
    )
    .max(20),
  other_skills: z
    .array(z.string())
    .max(10)
    .describe(
      "free-form Hebrew skill phrases that don't map to the taxonomy but seem worth surfacing",
    ),
});

export type CvExtractionOutput = z.infer<typeof CvExtractionSchema>;
