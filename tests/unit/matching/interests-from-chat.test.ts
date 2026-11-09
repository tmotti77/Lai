import { describe, it, expect } from "vitest";
import { riasecFromChatInterests } from "@/lib/matching/interestsFromChat";
import { buildMatchingProfile } from "@/lib/matching/profile";

describe("riasecFromChatInterests", () => {
  it("returns null for missing or empty input", () => {
    expect(riasecFromChatInterests(undefined)).toBeNull();
    expect(riasecFromChatInterests([])).toBeNull();
  });

  it("returns null when no interest matches the lexicon", () => {
    expect(
      riasecFromChatInterests([{ label: "Something vague", label_he: "משהו כללי", confidence: "high" }]),
    ).toBeNull();
  });

  it("maps a Hebrew-only label to its RIASEC letter", () => {
    const v = riasecFromChatInterests([{ label_he: "עיצוב גרפי", confidence: "high" }]);
    expect(v).not.toBeNull();
    expect(v!.A).toBe(100);
    expect(v!.R + v!.I + v!.S + v!.E + v!.C).toBe(0);
  });

  it("maps an English label with whole-word matching", () => {
    const v = riasecFromChatInterests([{ label: "Teaching kids", label_he: "", confidence: "high" }]);
    expect(v!.S).toBe(100);
  });

  it("does not match English keywords inside unrelated words", () => {
    // "art" must not fire inside "start"/"smart"; "car" must not fire inside "career".
    expect(
      riasecFromChatInterests([{ label: "Smart career start", label_he: "", confidence: "high" }]),
    ).toBeNull();
  });

  it("does not read loyalty (נאמנות) as art (אמנות)", () => {
    expect(riasecFromChatInterests([{ label_he: "נאמנות", confidence: "high" }])).toBeNull();
  });

  it("does not read army command (פיקוד) as coding (קוד)", () => {
    const v = riasecFromChatInterests([{ label_he: "פיקוד על חיילים", confidence: "high" }]);
    expect(v).not.toBeNull();
    expect(v!.I).toBe(0);
    expect(v!.C).toBe(0);
    expect(v!.E).toBe(100);
  });

  it("matches the Hebrew construct form (ה → ת)", () => {
    // "כתיבת" is the construct form of "כתיבה" (writing).
    const v = riasecFromChatInterests([{ label_he: "כתיבת שירים", confidence: "high" }]);
    expect(v!.A).toBe(100);
  });

  it("does not read TV series (סדרות) as order (סדר)", () => {
    expect(riasecFromChatInterests([{ label_he: "סדרות טלוויזיה", confidence: "high" }])).toBeNull();
  });

  it("maps app development and information security to programming letters", () => {
    for (const label_he of ["פיתוח אפליקציות", "אבטחת מידע"]) {
      const v = riasecFromChatInterests([{ label_he, confidence: "high" }]);
      expect(v).toEqual({ R: 0, I: 100, A: 0, S: 0, E: 0, C: 100 });
    }
  });

  it("matches order (סדר) when it is not part of סדרה/סדרות", () => {
    expect(riasecFromChatInterests([{ label_he: "סדר ומשמעת", confidence: "high" }])!.C).toBe(100);
  });

  it("does not read the Ministry of Defense as office work", () => {
    expect(riasecFromChatInterests([{ label_he: "משרד הביטחון", confidence: "high" }])).toBeNull();
    expect(riasecFromChatInterests([{ label_he: "עבודה משרדית", confidence: "high" }])!.C).toBe(100);
  });

  it("does not read superficial (שטחי) as field work (שטח)", () => {
    expect(riasecFromChatInterests([{ label_he: "שטחי", confidence: "high" }])).toBeNull();
    expect(riasecFromChatInterests([{ label_he: "עבודת שטח", confidence: "high" }])!.R).toBe(100);
  });

  it("keeps longer words from short stems on the intended letter", () => {
    // Reviewer-flagged stems: the longer word lands on the same letter, so no wrong signal.
    expect(riasecFromChatInterests([{ label_he: "רכבות", confidence: "high" }])!.R).toBe(100);
    expect(riasecFromChatInterests([{ label_he: "מזון טבעי", confidence: "high" }])!.R).toBe(100);
    expect(riasecFromChatInterests([{ label_he: "עסקאות", confidence: "high" }])!.E).toBe(100);
    expect(riasecFromChatInterests([{ label_he: "מדען", confidence: "high" }])!.I).toBe(100);
  });

  it("allows up to two attached Hebrew prefix letters, not three", () => {
    expect(riasecFromChatInterests([{ label_he: "ולמוזיקה", confidence: "high" }])!.A).toBe(100);
    expect(riasecFromChatInterests([{ label_he: "ובלמוזיקה", confidence: "high" }])).toBeNull();
  });

  it("expands a trailing * to an English word prefix", () => {
    expect(riasecFromChatInterests([{ label: "Photographer", confidence: "high" }])!.A).toBe(100);
  });

  it("matches English terms written inside label_he", () => {
    expect(riasecFromChatInterests([{ label_he: "UX", confidence: "high" }])!.A).toBe(100);
  });

  it("treats an unrecognized confidence value as medium", () => {
    const v = riasecFromChatInterests([
      { label_he: "מוזיקה", confidence: "high" },
      { label_he: "שיווק", confidence: "very" },
    ]);
    expect(v!.E).toBe(60);
  });

  it("counts a letter once when both labels of one interest match it", () => {
    const v = riasecFromChatInterests([
      { label: "Music", label_he: "מוזיקה", confidence: "high" },
      { label_he: "שיווק", confidence: "high" },
    ]);
    expect(v!.A).toBe(100);
    expect(v!.E).toBe(100);
  });

  it("splits a multi-letter interest evenly between its letters", () => {
    // Programming is Investigative + Conventional in the lexicon.
    const v = riasecFromChatInterests([{ label: "Programming", label_he: "תכנות", confidence: "high" }]);
    expect(v!.I).toBe(100);
    expect(v!.C).toBe(100);
    expect(v!.R + v!.A + v!.S + v!.E).toBe(0);
  });

  it("weights low-confidence interests below high-confidence ones", () => {
    const v = riasecFromChatInterests([
      { label_he: "מוזיקה", confidence: "high" },
      { label_he: "שיווק", confidence: "low" },
    ]);
    expect(v!.A).toBe(100);
    expect(v!.E).toBe(30);
  });

  it("treats a missing confidence as medium", () => {
    const v = riasecFromChatInterests([
      { label_he: "מוזיקה", confidence: "high" },
      { label_he: "שיווק" },
    ]);
    expect(v!.E).toBe(60);
  });

  it("is deterministic for the same input", () => {
    const input = [
      { label: "Technology", label_he: "טכנולוגיה", confidence: "high" },
      { label: "Helping people", label_he: "לעזור לאנשים", confidence: "medium" },
    ];
    expect(riasecFromChatInterests(input)).toEqual(riasecFromChatInterests(input));
  });

  it("ignores an interest whose label is not a string", () => {
    const v = riasecFromChatInterests([
      { label_he: undefined as unknown as string, confidence: "high" },
      { label_he: "ספורט", confidence: "high" },
    ]);
    expect(v!.R).toBe(100);
  });
});

describe("buildMatchingProfile interests (#50)", () => {
  const chatInterests = [{ label_he: "מוזיקה", confidence: "high" }];

  it("keeps formal RIASEC unchanged when present, even with chat interests", () => {
    const profile = buildMatchingProfile({
      data: { interests: chatInterests },
      formal: {
        riasec: { scores: { R: 60, I: 80, A: 30, S: 20, E: 40, C: 50 } },
        big5: null, values: null, constraints: null,
      },
    });
    expect(profile.interests).toEqual({ R: 60, I: 80, A: 30, S: 20, E: 40, C: 50 });
  });

  it("derives interests from chat when formal RIASEC is missing", () => {
    const profile = buildMatchingProfile({ data: { interests: chatInterests } });
    expect(profile.interests).toEqual({ R: 0, I: 0, A: 100, S: 0, E: 0, C: 0 });
  });

  it("stays null when there is neither formal RIASEC nor a matchable chat interest", () => {
    const profile = buildMatchingProfile({
      data: { interests: [{ label_he: "משהו כללי", confidence: "high" }] },
    });
    expect(profile.interests).toBeNull();
  });
});
