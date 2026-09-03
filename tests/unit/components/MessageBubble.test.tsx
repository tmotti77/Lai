/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble, normalizePath } from "@/components/chat/MessageBubble";

describe("MessageBubble normalizePath", () => {
  it("normalizes relative path without leading slash", () => {
    expect(normalizePath("recommendations")).toBe("/recommendations");
  });

  it("normalizes relative path with trailing slash", () => {
    expect(normalizePath("recommendations/")).toBe("/recommendations");
  });

  it("preserves absolute path with leading slash", () => {
    expect(normalizePath("/recommendations")).toBe("/recommendations");
  });

  it("preserves absolute http URL", () => {
    expect(normalizePath("https://example.com")).toBe("https://example.com");
  });

  it("preserves absolute https URL", () => {
    expect(normalizePath("https://example.com/path")).toBe("https://example.com/path");
  });

  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  it("handles complex relative path", () => {
    expect(normalizePath("recommendations/detail/")).toBe("/recommendations/detail");
  });
});

describe("MessageBubble bare path linking with punctuation", () => {
  it("links bare /recommendations followed by period", () => {
    render(<MessageBubble role="assistant" text="פנה ל- /recommendations." />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("/recommendations");
    // Period should not be part of the link
    expect(screen.getByText(/\./)).toBeTruthy();
  });

  it("links bare /recommendations followed by comma", () => {
    render(<MessageBubble role="assistant" text="עבור ל /recommendations, שם תמצא המלצות" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("/recommendations");
  });

  it("links bare /recommendations followed by markdown italic asterisk", () => {
    render(<MessageBubble role="assistant" text="ראה /recommendations.*" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("/recommendations");
  });

  it("links bare recommendations/ with trailing slash and period", () => {
    render(<MessageBubble role="assistant" text="לך ל recommendations/." />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("recommendations/");
  });

  it("links bare /recommendations at end of sentence with exclamation", () => {
    render(<MessageBubble role="assistant" text="עבור ל /recommendations!" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("/recommendations");
  });

  it("links bare /recommendations followed by closing parenthesis", () => {
    render(<MessageBubble role="assistant" text="(ראה /recommendations)" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/recommendations");
    expect(link).toHaveTextContent("/recommendations");
  });
});
