import { describe, it, expect } from "vitest";
import { FeedbackBody } from "@/app/api/feedback/route";

describe("FeedbackBody (Zod discriminated union)", () => {
  it("accepts valid thumb body", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "recommendations",
      target_type: "recommendation_occupation",
      target_id: "abc:data-analyst",
      thumbs_value: 1,
    })).not.toThrow();
  });

  it("accepts valid NPS body", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 9,
      nps_trigger: "pdf_download",
      comment_he: null,
    })).not.toThrow();
  });

  it("rejects thumb with NPS field", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "recommendations",
      target_type: "recommendation_occupation",
      target_id: "abc:data-analyst",
      thumbs_value: 1,
      nps_score: 5,
    })).toThrow();
  });

  it("rejects NPS out of range", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 11,
      nps_trigger: "pdf_download",
    })).toThrow();
  });

  it("rejects target_id over 128 chars", () => {
    expect(() => FeedbackBody.parse({
      kind: "thumb",
      surface: "interview",
      target_type: "interview_session",
      target_id: "x".repeat(129),
      thumbs_value: 1,
    })).toThrow();
  });

  it("rejects comment_he over 1000 chars on NPS", () => {
    expect(() => FeedbackBody.parse({
      kind: "nps",
      nps_score: 7,
      nps_trigger: "pdf_download",
      comment_he: "x".repeat(1001),
    })).toThrow();
  });
});
