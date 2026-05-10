import { describe, it, expect } from "vitest";
import { regexDistressCheck } from "@/lib/ai/safety/regex";

describe("regexDistressCheck", () => {
  it("flags Hebrew suicide ideation phrases", () => {
    expect(regexDistressCheck("אני רוצה למות").hit).toBe(true);
    expect(regexDistressCheck("אני חושב על התאבדות").hit).toBe(true);
    expect(regexDistressCheck("אני לא רוצה לחיות יותר").hit).toBe(true);
  });

  it("flags English suicide ideation", () => {
    expect(regexDistressCheck("I want to kill myself").hit).toBe(true);
    expect(regexDistressCheck("I'm thinking of ending it all").hit).toBe(true);
  });

  it("flags severe distress without explicit suicide", () => {
    const r = regexDistressCheck("אני בייאוש מוחלט אין לי מי לדבר איתו");
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.severity).toBe("distress");
  });

  it("does NOT flag normal career-question phrases", () => {
    expect(regexDistressCheck("אני אחרי צבא ולא יודע מה ללמוד").hit).toBe(false);
    expect(regexDistressCheck("אני שחוק בעבודה הנוכחית שלי").hit).toBe(false);
    expect(regexDistressCheck("הייתי רוצה לשנות כיוון").hit).toBe(false);
    expect(regexDistressCheck("I hate my current job").hit).toBe(false);
  });

  it("returns hit=false for empty/short input", () => {
    expect(regexDistressCheck("").hit).toBe(false);
    expect(regexDistressCheck("hi").hit).toBe(false);
  });

  it("crisis severity beats distress when both could match", () => {
    const r = regexDistressCheck("אני בייאוש מוחלט ואני רוצה למות");
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.severity).toBe("crisis");
  });
});
