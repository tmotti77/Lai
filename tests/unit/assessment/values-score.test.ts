import { describe, it, expect } from "vitest";
import { scoreValues, validateValuesSubmission } from "@/lib/assessment/values/score";
import { VALUES_OPTIONS_VERSION } from "@/lib/assessment/values/options";

describe("validateValuesSubmission", () => {
  it("accepts a valid submission", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "freedom", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).not.toThrow();
  });

  it("rejects when picked is not exactly 5", () => {
    expect(() =>
      validateValuesSubmission(
        { picked: ["money", "freedom"], ranked: ["money"] },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/exactly 5/);
  });

  it("rejects when ranked is not exactly 3", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "freedom"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/exactly 3/);
  });

  it("rejects when ranked references unpicked id", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "balance"],
          ranked: ["money", "status", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/must be subset/);
  });

  it("rejects unknown value id", () => {
    expect(() =>
      validateValuesSubmission(
        {
          picked: ["money", "freedom", "learning", "team", "nonsense"],
          ranked: ["money", "freedom", "learning"],
        },
        VALUES_OPTIONS_VERSION,
      ),
    ).toThrow(/unknown/);
  });
});

describe("scoreValues", () => {
  it("returns topThree (ranked) and alsoPicked (the rest)", () => {
    const submission = {
      picked: ["money", "freedom", "learning", "team", "balance"],
      ranked: ["learning", "money", "team"],
    };
    const scores = scoreValues(submission, VALUES_OPTIONS_VERSION);
    expect(scores.topThree).toEqual(["learning", "money", "team"]);
    expect(scores.alsoPicked.sort()).toEqual(["balance", "freedom"].sort());
  });
});
