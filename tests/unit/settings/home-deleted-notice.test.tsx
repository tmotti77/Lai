/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { he } from "@/lib/i18n/he";
import HomePage from "@/app/page";

// After a delete the dialog navigates to /?deleted=1 or, when storage cleanup was
// incomplete, /?deleted=partial (#51 part 2 critique #3). The two must read differently.
const page = async (params: Record<string, string>) =>
  render(await HomePage({ searchParams: Promise.resolve(params) }));

describe("home ?deleted notice", () => {
  it("deleted=1: full-deletion notice", async () => {
    await page({ deleted: "1" });
    expect(screen.getByRole("status")).toHaveTextContent(he.settings.delete.deletedNotice);
  });

  it("deleted=partial: distinct incomplete-cleanup notice", async () => {
    await page({ deleted: "partial" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(he.settings.delete.deletedPartialNotice);
    expect(status).not.toHaveTextContent(he.settings.delete.deletedNotice);
  });

  it("no param or unknown value: no notice", async () => {
    await page({ deleted: "yes" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("footer links to settings and privacy", async () => {
    await page({});
    expect(screen.getByRole("link", { name: he.settings.entryLink })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: he.settings.privacyLink })).toHaveAttribute("href", "/privacy");
  });
});
