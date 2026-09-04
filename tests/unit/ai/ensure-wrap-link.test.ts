import { describe, it, expect } from "vitest";
import { ensureRecommendationsLink } from "@/lib/ai/ensure-wrap-link";

describe("ensureRecommendationsLink", () => {
  it("appends link when text has no link", () => {
    const input = "שלום! סיימנו את השיחה.";
    const result = ensureRecommendationsLink(input);
    
    expect(result).toContain("שלום! סיימנו את השיחה.");
    expect(result).toContain("[לדף ההמלצות](/recommendations)");
  });

  it("does not append when markdown link already exists", () => {
    const input = "תודה! עבור [לדף ההמלצות](/recommendations) כדי לראות.";
    const result = ensureRecommendationsLink(input);
    
    // Should return unchanged (no double append)
    expect(result).toBe(input);
    expect(result.match(/\[.*?\]\(.*?recommendations.*?\)/g)).toHaveLength(1);
  });

  it("does not append when markdown link with trailing slash exists", () => {
    const input = "בוא נסכם. [לחץ כאן](recommendations/) לצפייה בהמלצות.";
    const result = ensureRecommendationsLink(input);
    
    expect(result).toBe(input);
  });

  it("does not append when markdown link with leading slash exists", () => {
    const input = "כל הכבוד! [המלצות](/recommendations) זמינות עכשיו.";
    const result = ensureRecommendationsLink(input);
    
    expect(result).toBe(input);
  });

  it("appends link when text has bare path but no markdown brackets", () => {
    const input = "פנה ל- /recommendations כדי לצפות.";
    const result = ensureRecommendationsLink(input);
    
    // Bare path doesn't count as a proper link; should append
    expect(result).not.toBe(input);
    expect(result).toContain("פנה ל- /recommendations כדי לצפות.");
    expect(result).toContain("[לדף ההמלצות](/recommendations)");
  });

  it("appends link when text mentions recommendations in prose", () => {
    const input = "יש לי המלצות מצוינות בשבילך.";
    const result = ensureRecommendationsLink(input);
    
    // Hebrew word "המלצות" doesn't match the path pattern
    expect(result).toContain("[לדף ההמלצות](/recommendations)");
  });

  it("handles empty string gracefully", () => {
    const result = ensureRecommendationsLink("");
    expect(result).toBe("");
  });

  it("handles whitespace-only string gracefully", () => {
    const result = ensureRecommendationsLink("   ");
    expect(result).toContain("   ");
  });

  it("detects link with extra whitespace in path", () => {
    const input = "עבור [כאן]( /recommendations ) לצפייה.";
    const result = ensureRecommendationsLink(input);
    
    // Regex should handle whitespace in parentheses
    expect(result).toBe(input);
  });

  it("is case-insensitive when detecting recommendations path", () => {
    const input = "בדוק [דף זה](/RECOMMENDATIONS) למידע נוסף.";
    const result = ensureRecommendationsLink(input);
    
    // Case-insensitive match should detect the link
    expect(result).toBe(input);
  });
});
