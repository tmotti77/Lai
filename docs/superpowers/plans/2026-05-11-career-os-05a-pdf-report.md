# CareerOS — Phase 5a: PDF Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a Hebrew RTL PDF report from the user's cached recommendations (Phase 4 output). The PDF is the user-facing artifact: a single shareable document containing the disclaimer, a "what we heard" profile mirror, the 3 paths with explanations, a top-5 occupation ranking with score breakdown, and follow-up questions. **No new LLM call** — reuses the Hebrew prose already cached in `recommendations.prose`. Download triggered from `/recommendations`.

**Architecture:** PDF generation is fully on-demand via `GET /api/report/pdf`. No `reports` table — the PDF is composed at request time from the latest `recommendations` row + the `occupations` catalog. The renderer is `@react-pdf/renderer` running in Node.js with Heebo registered as the Hebrew typeface. Each section is a React component under `lib/pdf/sections/`; the document composes them. Authorization mirrors Phase 4: anonymous-OK, the route resolves the user via cookie and reads their own recommendation.

**Tech Stack:** Builds on Phase 4. Adds `@react-pdf/renderer` (~5MB) for PDF generation + the Heebo `.ttf` file from Google Fonts. No new external services.

---

## 1. Decisions baked into this plan

| Decision | Choice | Why |
|---|---|---|
| Renderer | **`@react-pdf/renderer`** | Master roadmap §1 already locked this in. React-component model maps well to our shadcn-trained team mental model. Server-side rendering in Node.js works. |
| Persistence | **None — generate on-demand** | The PDF is derived from `recommendations` (the cache). No need to persist twice. If a user re-downloads, the cache hits Phase 4's `recommendations` row → re-render in <1s. Phase 5c "save report" can later persist a snapshot if needed. |
| LLM | **None — reuse `recommendations.prose`** | Phase 4's prose generator already wrote Hebrew explanations per top-5 role. PDF reads them directly. Zero new LLM cost. |
| Font | **Heebo** (Google Fonts, OFL license) | Master roadmap §2.5. Use TTF file in `public/fonts/`, register with `Font.register({ family: "Heebo", fonts: [...] })`. |
| RTL strategy | **`direction: "rtl"` at Page level + `textAlign: "right"` on text styles + `dir="auto"` semantics where supported** | @react-pdf has paragraph-level RTL support. Numbers and Latin embedded in Hebrew lines should bidi-correct without manual markers in most cases. The Task 1 spike validates this assumption before we build the full report. |
| Route shape | **`GET /api/report/pdf`** (no id param) | Anonymous users have no stable user-facing id. Route resolves from cookie. Phase 5c will introduce `/api/report/[id]/pdf` once save-flow lands. |
| HTML view of report | **Out of scope** — defer to Phase 5c polish | Duplicative; the `/recommendations` page already shows the same content. Saving the time. |
| Section structure | **Cover → Disclaimer → ProfileMirror → ThreePaths → RankingsTable → FollowUps** | Same flow as the master roadmap §4.5 spec for Phase 5. Disclaimer is on cover *and* repeated in footer — legal requirement. |
| Empty profile / no recommendations | **Route returns 400 with `error: "no_recommendation"`**; UI hides the download button | Don't generate a useless empty PDF. |
| Authorization | **Anonymous-OK** (same pattern as Phase 4) | Funnel-critical. Sign-up is Phase 5c's conversion event, not Phase 5a's gate. |
| Download button placement | **In the cached-banner row on `/recommendations`** (next to "צור מחדש") | The recommendations page is the only place this matters. No separate download surface. |
| Filename | **`careeros-report-{YYYYMMDD}.pdf`** | Predictable for users; date helps when they regenerate later. |
| Failures | **Render errors → 500 with logged stack** | Don't expose internals to user; sentry/console captures detail for debugging. |
| Disclaimer text | **Reuses `he.disclaimer.long` from existing i18n** | Same legal text shown in the chat header banner. Consistency required by master roadmap §6 risk mitigation. |

**Out of scope for this plan (Phase 5b / 5c / later):**
- 30-day action plan (Phase 5b)
- "Save report" anonymous → registered upgrade (Phase 5c)
- Email delivery via Resend (Phase 5c)
- "Less-recommended roles + why" section
- Persistent report snapshots (a `reports` table)
- Shareable URLs / public links
- Multi-language PDF (English support is post-MVP entirely)

---

## 2. Architectural notes worth documenting

### 2.1 Why no `reports` table in this phase
The PDF is a *derivation* of the `recommendations` row, not a new artifact. Persisting it doubles the storage and creates two sources of truth. If a user regenerates recommendations, the old PDF is silently stale. On-demand generation reads the freshest cache and renders in ~500ms — faster than the network round-trip a stored PDF would save. Phase 5c can add a snapshot table when "save this version forever" becomes a real user request.

### 2.2 RTL in @react-pdf — the load-bearing assumption
@react-pdf supports `direction: "rtl"` on Page-level styles, which flips inline-direction and right-aligns text by default. Open questions the Task 1 spike must answer:
1. Does Heebo render cleanly with proper glyph shaping (no missing characters / boxes)?
2. Do mixed-content lines ("ב-3 שנים האחרונות" — Hebrew + digits) bidi-correct automatically, or do we need explicit Unicode markers (`‏`, `‎`)?
3. Do bullet lists and indented children inherit the RTL direction, or does each child need its own `direction: "rtl"`?
4. How does Hebrew font weight work — does Heebo register with `fontWeight: 700` for bold variants?

If the spike fails on any of these, the fallback is to use a different renderer (`puppeteer` to render an HTML page to PDF) — but that's a 2-3x performance regression and adds Chromium to the deploy. We commit to `@react-pdf` first and only fall back if the spike proves it unworkable.

### 2.3 Disclaimer in 4 places — current state + this phase
Master roadmap §6 lists 4 places the disclaimer must appear: chat header banner, report cover, T&C, system prompt. Currently 3 are landed (chat banner from Phase 1, T&C page from Phase 1, system prompt from Phase 2). This phase adds the 4th: report cover + report footer. After Phase 5a merges, the 4-locations requirement is complete; Phase 7's launch checklist gates on it.

### 2.4 Why the route resolves from cookie, not URL param
Phase 5c will introduce stable user-facing ids (`/api/report/[id]/pdf`) along with the save-flow, because at that point the user is registered and can share/re-access a specific past report. In Phase 5a, anonymous users have only a `co_anon` cookie; there's no meaningful "report id" for them. Route shape: `GET /api/report/pdf` reads the cookie → resolves internal user_id → loads the latest `recommendations` row → renders.

### 2.5 Section component pattern
Each PDF section is a React component receiving the data it needs (e.g. `<ProfileMirror profile={profile} />`), not the full report data. This keeps sections testable in isolation later if we add visual regression tests, and lets us reuse them in the HTML view if Phase 5c restores it.

### 2.6 Caching strategy for the PDF route
- The underlying `recommendations` row is already cached via Phase 4's `profile_hash` keying
- PDF render is fast (~500ms) and stateless — no benefit to caching the PDF bytes themselves
- HTTP `Cache-Control: private, no-cache` because the PDF contains user PII and shouldn't sit in any shared cache

---

## 3. File structure (target end-state for Phase 5a)

```
public/fonts/
├── Heebo-Regular.ttf                       # NEW: from Google Fonts
├── Heebo-Bold.ttf                          # NEW
└── Heebo-SemiBold.ttf                      # NEW

lib/pdf/                                    # NEW directory
├── fonts.ts                                # Font.register() call, once at module load
├── styles.ts                               # Shared StyleSheet.create — page, heading, body
├── types.ts                                # ReportData type
├── loadReportData.ts                       # builds ReportData from DB (recommendations + occupations + profile)
├── sections/
│   ├── Cover.tsx                           # Title, subtitle, generated date, disclaimer
│   ├── ProfileMirror.tsx                   # "What we heard": interests, values, skills, constraints
│   ├── ThreePaths.tsx                      # 3 path cards: safe / growth / wildcard
│   ├── RankingsTable.tsx                   # Top-5 occupations with breakdowns
│   ├── FollowUps.tsx                       # Follow-up questions
│   └── DisclaimerFooter.tsx                # Repeated short disclaimer at page bottom
├── ReportDocument.tsx                      # Composes sections inside <Document><Page>
└── render.ts                               # renderToBuffer(ReportDocument)

app/api/report/pdf/route.ts                 # NEW: GET handler

components/recommendations/                 # MODIFIED
└── RecommendationsClient.tsx               # add Download button to cached banner

lib/i18n/
└── he.ts                                   # MODIFIED: add report.* section
```

---

## 4. Pre-flight (do once before Task 1)

- [ ] Confirm Phase 3a + Phase 4 are on `feat/phase-4-matching-engine` (current branch) and PR #2 is open
- [ ] Confirm `npm run dev` works and `/recommendations` renders cards with prose
- [ ] Verify `recommendations` table has at least one row (re-run a recommendation flow if needed)
- [ ] Confirm `.env.local` has all keys; no new env vars needed for Phase 5a

---

## Task 1: Install deps + Heebo font + RTL spike

**Files:**
- Create: `public/fonts/Heebo-Regular.ttf`, `Heebo-Bold.ttf`, `Heebo-SemiBold.ttf`
- Create: `lib/pdf/fonts.ts`
- Create: `lib/pdf/spike.ts` (temporary — deleted at end of task)

- [ ] **Step 1: Install dependency**

```powershell
npm install @react-pdf/renderer
```

- [ ] **Step 2: Download Heebo TTF files**

Download from https://fonts.google.com/specimen/Heebo (OFL license). Place these three files in `public/fonts/`:
- `Heebo-Regular.ttf`
- `Heebo-Bold.ttf`
- `Heebo-SemiBold.ttf`

(If `public/fonts/` doesn't exist, create it.)

- [ ] **Step 3: Write `lib/pdf/fonts.ts`** — paste exactly:

```ts
import "server-only";
import { Font } from "@react-pdf/renderer";
import path from "node:path";

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Heebo",
    fonts: [
      { src: path.join(fontsDir, "Heebo-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(fontsDir, "Heebo-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(fontsDir, "Heebo-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Disable hyphenation — Hebrew doesn't hyphenate.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
```

- [ ] **Step 4: Write the spike** at `lib/pdf/spike.ts`:

```ts
import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import React from "react";

ensureFontsRegistered();

const styles = StyleSheet.create({
  page: { fontFamily: "Heebo", direction: "rtl", padding: 40, fontSize: 12 },
  h1: { fontSize: 24, fontWeight: "bold", marginBottom: 12, textAlign: "right" },
  body: { fontSize: 12, marginBottom: 8, textAlign: "right", lineHeight: 1.5 },
  mixed: { fontSize: 12, marginBottom: 8, textAlign: "right" },
});

const SpikeDocument = (): React.ReactElement => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View>
        <Text style={styles.h1}>בדיקת RTL וגלגלי עברית</Text>
        <Text style={styles.body}>
          זה משפט בעברית רגיל שאמור להיות מיושר לימין. אם הטקסט נראה תקין ובלי ריבועים, הגלגלים נטענו.
        </Text>
        <Text style={styles.mixed}>
          ב-3 שנים האחרונות הרווחתי 18,000 ש&quot;ח בחודש. בדיקה: 5/5 או 3.14, ואותיות לטיניות: software.
        </Text>
        <Text style={[styles.body, { fontWeight: "bold" }]}>
          זה טקסט מודגש (font-weight bold).
        </Text>
        <Text style={[styles.body, { fontWeight: 600 }]}>
          זה טקסט semibold (font-weight 600).
        </Text>
      </View>
    </Page>
  </Document>
);

export async function runSpike(): Promise<Buffer> {
  return renderToBuffer(<SpikeDocument />);
}
```

- [ ] **Step 5: Create a one-off script to run the spike**

`scripts/pdf-spike.ts`:
```ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { runSpike } from "@/lib/pdf/spike";

async function main() {
  const buf = await runSpike();
  writeFileSync("spike.pdf", buf);
  console.log("OK wrote spike.pdf (size: " + buf.length + " bytes)");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json` scripts:
```json
"pdf:spike": "tsx scripts/pdf-spike.ts"
```

Run:
```powershell
npm run pdf:spike
```

Expected: `spike.pdf` created in repo root, ~30-100KB.

- [ ] **Step 6: Open `spike.pdf` and visually verify**

Check:
- Hebrew renders without missing glyphs (no boxes/question marks)
- Text is right-aligned
- The mixed-content line ("ב-3 שנים האחרונות הרווחתי 18,000 ש"ח") reads correctly: Hebrew flows right-to-left, the digits stay left-to-right
- Bold and semibold weights are visually distinct
- File opens cleanly in browser preview AND Acrobat/Preview

If anything fails: STOP. Don't continue with the rest of the plan. Decide whether to:
- Adjust the font registration (e.g. different `src` path format)
- Try @react-pdf's `bidi` package or manual `‏` markers
- Fall back to puppeteer-based rendering (much bigger architectural change)

If all checks pass:

- [ ] **Step 7: Delete the spike artifacts**

Remove `lib/pdf/spike.ts`, `scripts/pdf-spike.ts`, the `pdf:spike` npm script entry, and `spike.pdf` itself. Keep `lib/pdf/fonts.ts` — that's the real artifact from this task.

Add `spike.pdf` to `.gitignore` defensively (so future spike runs don't accidentally commit a PDF):
```
# Phase 5a spike artifact
spike.pdf
```

- [ ] **Step 8: Commit**

```powershell
git add public/fonts lib/pdf/fonts.ts package.json package-lock.json .gitignore
git commit -m "feat(pdf): install @react-pdf/renderer, register Heebo, validate RTL spike"
```

---

## Task 2: Shared styles + types + i18n strings

**Files:**
- Create: `lib/pdf/styles.ts`
- Create: `lib/pdf/types.ts`
- Modify: `lib/i18n/he.ts`

- [ ] **Step 1: Write `lib/pdf/styles.ts`**

```ts
import { StyleSheet } from "@react-pdf/renderer";

export const colors = {
  text: "#0f172a",
  muted: "#64748b",
  accent: "#3b82f6",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  scoreBarBg: "#e2e8f0",
  scoreBarFill: "#3b82f6",
  pathSafeAccent: "#10b981",
  pathGrowthAccent: "#3b82f6",
  pathWildcardAccent: "#8b5cf6",
};

export const styles = StyleSheet.create({
  page: {
    fontFamily: "Heebo",
    direction: "rtl",
    padding: 48,
    fontSize: 11,
    color: colors.text,
    lineHeight: 1.5,
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 9,
    color: colors.muted,
  },
  h1: { fontSize: 22, fontWeight: "bold", textAlign: "right", marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: "bold", textAlign: "right", marginTop: 16, marginBottom: 8 },
  h3: { fontSize: 13, fontWeight: 600, textAlign: "right", marginBottom: 6 },
  body: { fontSize: 11, textAlign: "right", marginBottom: 6 },
  small: { fontSize: 9, textAlign: "right", color: colors.muted },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginVertical: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  scoreLabel: {
    fontSize: 10,
    width: 80,
    textAlign: "right",
    marginEnd: 8,
  },
  scoreBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: colors.scoreBarBg,
    borderRadius: 2,
  },
  scoreBarFill: {
    height: 4,
    backgroundColor: colors.scoreBarFill,
    borderRadius: 2,
  },
  scoreValue: {
    width: 28,
    fontSize: 9,
    textAlign: "left",
    marginStart: 6,
  },
});
```

- [ ] **Step 2: Write `lib/pdf/types.ts`**

```ts
import type { Ranking, Paths, Occupation, MatchingProfile } from "@/lib/matching/types";

export type ReportData = {
  generatedAt: string;        // ISO timestamp
  userDisplayName: string | null;
  profile: MatchingProfile;
  profileSummaryHe: string | null;  // from career_profile.data.summary_he, if any
  rankings: Ranking[];        // top-N (already capped by API)
  paths: Paths;
  prose: Record<string, string>;
  occupations: Occupation[];
};
```

- [ ] **Step 3: Add `report` section to `lib/i18n/he.ts`** — after the `recommendations` section, before the closing `} as const;`:

```ts
  report: {
    title: "דוח קריירה אישי",
    subtitle: "סיכום של מה שלמדנו עליך והכיוונים שמתאימים — להוריד, לשתף עם יועץ, או לחזור אליו בעוד חצי שנה.",
    generatedOn: "נוצר ב-{date}",
    sections: {
      profileMirror: {
        title: "מה שמענו ממך",
        introNoData: "עוד לא חלקת מספיק מידע. ככל שתעבור על שאלונים נוספים, הדוח יהיה אישי יותר.",
        interestsLabel: "תחומי עניין דומיננטיים",
        valuesLabel: "ערכים מרכזיים",
        skillsLabel: "כישורים שזיהינו",
        constraintsLabel: "אילוצים מעשיים",
      },
      threePaths: {
        title: "שלושה מסלולים לבחירה",
        safe: "מסלול בטוח",
        growth: "מסלול צמיחה",
        wildcard: "מסלול ג'וקר",
        noPathOption: "אין אפשרות מובהקת במסלול הזה לפי הפרופיל הנוכחי שלך.",
      },
      rankings: {
        title: "חמשת המקצועות המובילים",
        scoreLabel: "ציון התאמה",
        breakdown: {
          interests: "עניין",
          skills: "כישורים",
          values: "ערכים",
          big5: "אופי",
          constraints: "אילוצים",
          market: "שוק",
        },
      },
      followUps: {
        title: "מה הצעד הבא",
        items: [
          "בחר 1-2 מקצועות מהדוח ובדוק שתי משרות אמיתיות בלינקדאין/דרושים.",
          "שאל אדם שעובד באחד המסלולים שיחה של 20 דקות על איך נראה יום עבודה.",
          "אם יש קורס הכשרה רלוונטי, הירשם לשיעור ניסיון או צפה ב-3 שיעורים פתוחים.",
          "חזור לשיחה עם CareerOS בעוד שבועיים עם מה שלמדת — הדוח יתעדכן.",
        ],
      },
    },
    disclaimer: {
      cover: "המערכת מספקת הכוונה בלבד. היא אינה אבחון פסיכולוגי, אינה ייעוץ קליני, ואינה מבטיחה הצלחה תעסוקתית.",
      footer: "אינו ייעוץ קליני. לפרטים מלאים — מדיניות הפרטיות ותנאי השימוש באתר.",
    },
  },
```

- [ ] **Step 4: Verify TS compile**

```powershell
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add lib/pdf/styles.ts lib/pdf/types.ts lib/i18n/he.ts
git commit -m "feat(pdf): shared styles, ReportData types, Hebrew strings"
```

---

## Task 3: Data loader — `loadReportData`

**Files:**
- Create: `lib/pdf/loadReportData.ts`

- [ ] **Step 1: Write the loader**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { loadAllOccupations } from "@/lib/db/occupations";
import { getProfile } from "@/lib/db/profile";
import { buildMatchingProfile } from "@/lib/matching/profile";
import type { ReportData } from "./types";
import type { Ranking, Paths } from "@/lib/matching/types";

export async function loadReportData(userId: string): Promise<ReportData | null> {
  const svc = createServiceClient();

  const [{ data: rec }, occupations, userRow] = await Promise.all([
    svc
      .from("recommendations")
      .select("rankings, paths, prose, generated_at")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadAllOccupations(),
    svc
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  if (!rec) return null;

  // Re-derive the profile that fed the recommendation, so the report mirrors it.
  // Use the most recent conversation's profile to align with what the cached
  // recommendation was actually computed against.
  const { data: convs } = await svc
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = convs?.[0]?.id;
  let rawProfile: Awaited<ReturnType<typeof getProfile>> | null = null;
  if (conversationId) {
    rawProfile = await getProfile(userId, conversationId).catch(() => null);
  }
  const profile = buildMatchingProfile(rawProfile ?? null);

  const profileSummaryHe =
    rawProfile && typeof rawProfile === "object" && "data" in rawProfile
      ? ((rawProfile.data as { summary_he?: string } | null)?.summary_he ?? null)
      : null;

  return {
    generatedAt: rec.generated_at,
    userDisplayName: userRow?.display_name ?? null,
    profile,
    profileSummaryHe,
    rankings: rec.rankings as unknown as Ranking[],
    paths: rec.paths as unknown as Paths,
    prose: rec.prose as unknown as Record<string, string>,
    occupations,
  };
}
```

- [ ] **Step 2: Verify TS compile**

- [ ] **Step 3: Commit**

```powershell
git add lib/pdf/loadReportData.ts
git commit -m "feat(pdf): loadReportData assembles ReportData from cached recommendation"
```

---

## Task 4: PDF sections — Cover + DisclaimerFooter

**Files:**
- Create: `lib/pdf/sections/Cover.tsx`
- Create: `lib/pdf/sections/DisclaimerFooter.tsx`

- [ ] **Step 1: Write `Cover.tsx`**

```tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";

const coverStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  brand: { fontSize: 36, fontWeight: "bold", marginBottom: 4, color: colors.accent },
  title: { fontSize: 22, fontWeight: 600, marginBottom: 12, textAlign: "center" },
  subtitle: { fontSize: 11, color: colors.muted, marginBottom: 32, maxWidth: 380, textAlign: "center", lineHeight: 1.5 },
  meta: { fontSize: 10, color: colors.muted, marginBottom: 8 },
  disclaimer: {
    marginTop: 80,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    fontSize: 10,
    color: colors.muted,
    textAlign: "right",
    maxWidth: 460,
    lineHeight: 1.5,
  },
});

export function Cover({
  userDisplayName,
  generatedAt,
}: {
  userDisplayName: string | null;
  generatedAt: string;
}) {
  const date = new Date(generatedAt).toLocaleDateString("he-IL", {
    day: "numeric", month: "long", year: "numeric",
  });
  const generatedLine = he.report.generatedOn.replace("{date}", date);

  return (
    <View style={coverStyles.container}>
      <Text style={coverStyles.brand}>{he.brand.name}</Text>
      <Text style={coverStyles.title}>{he.report.title}</Text>
      <Text style={coverStyles.subtitle}>{he.report.subtitle}</Text>
      {userDisplayName && (
        <Text style={coverStyles.meta}>{userDisplayName}</Text>
      )}
      <Text style={coverStyles.meta}>{generatedLine}</Text>
      <Text style={coverStyles.disclaimer}>{he.report.disclaimer.cover}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Write `DisclaimerFooter.tsx`**

```tsx
import React from "react";
import { Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { he } from "@/lib/i18n/he";

const footerStyles = StyleSheet.create({
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8,
    color: colors.muted,
  },
});

export function DisclaimerFooter() {
  return <Text style={footerStyles.footer} fixed>{he.report.disclaimer.footer}</Text>;
}
```

- [ ] **Step 3: Commit**

```powershell
git add lib/pdf/sections/Cover.tsx lib/pdf/sections/DisclaimerFooter.tsx
git commit -m "feat(pdf): Cover and DisclaimerFooter sections"
```

---

## Task 5: PDF section — ProfileMirror

**Files:**
- Create: `lib/pdf/sections/ProfileMirror.tsx`

- [ ] **Step 1: Write the section**

```tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { MatchingProfile } from "@/lib/matching/types";

const labels = he.report.sections.profileMirror;

const localStyles = StyleSheet.create({
  block: { marginBottom: 8 },
  label: { fontSize: 10, fontWeight: 600, color: colors.muted, marginBottom: 2 },
  value: { fontSize: 11, textAlign: "right" },
  bullet: { fontSize: 11, marginBottom: 2, textAlign: "right" },
});

export function ProfileMirror({
  profile,
  summaryHe,
}: {
  profile: MatchingProfile;
  summaryHe: string | null;
}) {
  const hasAnything = profile.interests || profile.skills || profile.values || profile.constraints;

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>

      {!hasAnything && !summaryHe && (
        <Text style={styles.body}>{labels.introNoData}</Text>
      )}

      {summaryHe && (
        <Text style={[styles.body, { marginBottom: 12 }]}>{summaryHe}</Text>
      )}

      {profile.interests && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.interestsLabel}</Text>
          <Text style={localStyles.value}>{topRiasecLabel(profile.interests)}</Text>
        </View>
      )}

      {profile.values && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.valuesLabel}</Text>
          <Text style={localStyles.value}>{profile.values.topThree.join(" · ")}</Text>
        </View>
      )}

      {profile.skills && profile.skills.length > 0 && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.skillsLabel}</Text>
          <Text style={localStyles.value}>
            {profile.skills.slice(0, 8).map((s) => s.id).join(" · ")}
          </Text>
        </View>
      )}

      {profile.constraints && (
        <View style={localStyles.block}>
          <Text style={localStyles.label}>{labels.constraintsLabel}</Text>
          <Text style={localStyles.value}>{constraintsSummary(profile.constraints)}</Text>
        </View>
      )}
    </View>
  );
}

const RIASEC_NAMES_HE: Record<string, string> = {
  R: "מעשי-טכני", I: "חוקר", A: "אומנותי", S: "חברתי", E: "יזמי", C: "מסודר",
};

function topRiasecLabel(interests: NonNullable<MatchingProfile["interests"]>): string {
  const entries: [string, number][] = (Object.keys(interests) as (keyof typeof interests)[])
    .map((k) => [k as string, interests[k] as number]);
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.map(([k]) => RIASEC_NAMES_HE[k] ?? k).join(" · ");
}

function constraintsSummary(c: NonNullable<MatchingProfile["constraints"]>): string {
  const parts: string[] = [];
  if (c.location_he) parts.push(c.location_he);
  if (c.time_per_week_hours !== undefined) parts.push(`${c.time_per_week_hours} שעות בשבוע`);
  if (c.training_budget_nis !== undefined) parts.push(`תקציב הכשרה ${c.training_budget_nis.toLocaleString("he-IL")} ש"ח`);
  if (c.english_level) parts.push(`אנגלית ${c.english_level}`);
  return parts.join(" · ");
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/pdf/sections/ProfileMirror.tsx
git commit -m "feat(pdf): ProfileMirror section"
```

---

## Task 6: PDF section — ThreePaths

**Files:**
- Create: `lib/pdf/sections/ThreePaths.tsx`

- [ ] **Step 1: Write the section**

```tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { Paths, Occupation, Ranking } from "@/lib/matching/types";

const labels = he.report.sections.threePaths;

const localStyles = StyleSheet.create({
  pathCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  pathLabel: { fontSize: 10, fontWeight: "bold", color: colors.accent, marginBottom: 4, textAlign: "right" },
  title: { fontSize: 14, fontWeight: 600, marginBottom: 6, textAlign: "right" },
  prose: { fontSize: 10, lineHeight: 1.5, textAlign: "right", color: colors.text },
  noOption: { fontSize: 10, color: colors.muted, textAlign: "right" },
});

const PATH_COLORS: Record<keyof Paths, string> = {
  safe: colors.pathSafeAccent,
  growth: colors.pathGrowthAccent,
  wildcard: colors.pathWildcardAccent,
};

export function ThreePaths({
  paths,
  rankings,
  occupations,
  prose,
}: {
  paths: Paths;
  rankings: Ranking[];
  occupations: Occupation[];
  prose: Record<string, string>;
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const slots: { key: keyof Paths; label: string; id: string | null }[] = [
    { key: "safe", label: labels.safe, id: paths.safe },
    { key: "growth", label: labels.growth, id: paths.growth },
    { key: "wildcard", label: labels.wildcard, id: paths.wildcard },
  ];

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {slots.map(({ key, label, id }) => {
        if (!id) {
          return (
            <View key={key} style={[localStyles.pathCard, { borderStyle: "dashed" }]}>
              <Text style={[localStyles.pathLabel, { color: PATH_COLORS[key] }]}>{label}</Text>
              <Text style={localStyles.noOption}>{labels.noPathOption}</Text>
            </View>
          );
        }
        const occ = occMap.get(id);
        if (!occ) return null;
        return (
          <View key={key} style={localStyles.pathCard}>
            <Text style={[localStyles.pathLabel, { color: PATH_COLORS[key] }]}>{label}</Text>
            <Text style={localStyles.title}>{occ.title_he}</Text>
            {prose[id] && <Text style={localStyles.prose}>{prose[id]}</Text>}
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/pdf/sections/ThreePaths.tsx
git commit -m "feat(pdf): ThreePaths section"
```

---

## Task 7: PDF section — RankingsTable

**Files:**
- Create: `lib/pdf/sections/RankingsTable.tsx`

- [ ] **Step 1: Write the section**

```tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";
import type { Ranking, Occupation, ScoreBreakdown } from "@/lib/matching/types";

const labels = he.report.sections.rankings;
const breakdownLabels = labels.breakdown;

const localStyles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: { fontSize: 13, fontWeight: 600 },
  totalScore: { fontSize: 11, fontWeight: 600, color: colors.accent },
  totalLabel: { fontSize: 9, color: colors.muted },
  description: { fontSize: 10, color: colors.muted, marginBottom: 6, textAlign: "right" },
});

const ROW_ORDER: (keyof ScoreBreakdown)[] = ["interests", "skills", "values", "big5", "constraints", "market"];

export function RankingsTable({
  rankings,
  occupations,
}: {
  rankings: Ranking[];
  occupations: Occupation[];
}) {
  const occMap = new Map(occupations.map((o) => [o.id, o]));
  const top = rankings.slice(0, 5);

  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {top.map((r) => {
        const occ = occMap.get(r.occupation_id);
        if (!occ) return null;
        return (
          <View key={r.occupation_id} style={localStyles.row} wrap={false}>
            <View style={localStyles.header}>
              <Text style={localStyles.title}>{occ.title_he}</Text>
              <View>
                <Text style={localStyles.totalLabel}>{labels.scoreLabel}</Text>
                <Text style={localStyles.totalScore}>{r.total_score}</Text>
              </View>
            </View>
            <Text style={localStyles.description}>{occ.description_he}</Text>
            <View>
              {ROW_ORDER.map((key) => {
                const v = r.breakdown[key];
                if (v === null) return null;
                return (
                  <View key={key} style={styles.scoreRow}>
                    <Text style={styles.scoreLabel}>{breakdownLabels[key]}</Text>
                    <View style={styles.scoreBarBg}>
                      <View style={[styles.scoreBarFill, { width: `${v}%` }]} />
                    </View>
                    <Text style={styles.scoreValue}>{v}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/pdf/sections/RankingsTable.tsx
git commit -m "feat(pdf): RankingsTable section with per-dimension score bars"
```

---

## Task 8: PDF section — FollowUps

**Files:**
- Create: `lib/pdf/sections/FollowUps.tsx`

- [ ] **Step 1: Write the section**

```tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { styles, colors } from "../styles";
import { he } from "@/lib/i18n/he";

const labels = he.report.sections.followUps;

const localStyles = StyleSheet.create({
  item: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  bullet: {
    width: 16,
    fontSize: 11,
    color: colors.accent,
    fontWeight: "bold",
    textAlign: "center",
  },
  body: {
    flex: 1,
    fontSize: 11,
    textAlign: "right",
    lineHeight: 1.5,
  },
});

export function FollowUps() {
  return (
    <View>
      <Text style={styles.h2}>{labels.title}</Text>
      {labels.items.map((item, i) => (
        <View key={i} style={localStyles.item}>
          <Text style={localStyles.bullet}>{i + 1}.</Text>
          <Text style={localStyles.body}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
git add lib/pdf/sections/FollowUps.tsx
git commit -m "feat(pdf): FollowUps section with numbered action items"
```

---

## Task 9: ReportDocument composer + render

**Files:**
- Create: `lib/pdf/ReportDocument.tsx`
- Create: `lib/pdf/render.ts`

- [ ] **Step 1: Write `ReportDocument.tsx`**

```tsx
import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Cover } from "./sections/Cover";
import { ProfileMirror } from "./sections/ProfileMirror";
import { ThreePaths } from "./sections/ThreePaths";
import { RankingsTable } from "./sections/RankingsTable";
import { FollowUps } from "./sections/FollowUps";
import { DisclaimerFooter } from "./sections/DisclaimerFooter";
import type { ReportData } from "./types";

export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Cover userDisplayName={data.userDisplayName} generatedAt={data.generatedAt} />
      </Page>

      <Page size="A4" style={styles.page}>
        <ProfileMirror profile={data.profile} summaryHe={data.profileSummaryHe} />
        <View style={styles.divider} />
        <ThreePaths
          paths={data.paths}
          rankings={data.rankings}
          occupations={data.occupations}
          prose={data.prose}
        />
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        <DisclaimerFooter />
      </Page>

      <Page size="A4" style={styles.page}>
        <RankingsTable rankings={data.rankings} occupations={data.occupations} />
        <View style={styles.divider} />
        <FollowUps />
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
        <DisclaimerFooter />
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Write `render.ts`**

```ts
import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import { ReportDocument } from "./ReportDocument";
import type { ReportData } from "./types";
import React from "react";

export async function renderReport(data: ReportData): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(<ReportDocument data={data} />);
}
```

- [ ] **Step 3: Verify TS compile**

If `renderToBuffer` complains about JSX in a `.ts` file, rename `render.ts` to `render.tsx`. Adjust imports across the codebase if you do.

- [ ] **Step 4: Commit**

```powershell
git add lib/pdf/ReportDocument.tsx lib/pdf/render.ts
git commit -m "feat(pdf): ReportDocument composer + renderReport buffer renderer"
```

---

## Task 10: API route — `GET /api/report/pdf`

**Files:**
- Create: `app/api/report/pdf/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { loadReportData } from "@/lib/pdf/loadReportData";
import { renderReport } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const internalUserId = await getOrCreateAnonymousUserId(user?.id);

    const data = await loadReportData(internalUserId);
    if (!data) {
      return Response.json({ error: "no_recommendation" }, { status: 400 });
    }

    const buffer = await renderReport(data);
    const dateStr = new Date(data.generatedAt).toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `careeros-report-${dateStr}.pdf`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report/pdf] error", { message, stack: err instanceof Error ? err.stack : undefined });
    return Response.json({ error: "render_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

```powershell
npm run build
```

Expected: `ƒ /api/report/pdf` appears in the route table.

- [ ] **Step 3: Commit**

```powershell
git add app/api/report/pdf/route.ts
git commit -m "feat(api): GET /api/report/pdf streams generated PDF"
```

---

## Task 11: UI — Download button on recommendations page

**Files:**
- Modify: `components/recommendations/RecommendationsClient.tsx`
- Modify: `lib/i18n/he.ts` (add download string to `recommendations.*`)

- [ ] **Step 1: Add download label to i18n**

In `lib/i18n/he.ts`, find the `recommendations` section and add inside it:
```ts
    downloadPdf: "הורד דוח PDF",
    downloadingPdf: "מכין PDF…",
```
(Add somewhere alongside the existing `regenerate` and `cachedNote` keys.)

- [ ] **Step 2: Read current `RecommendationsClient.tsx`**

```powershell
type "components\recommendations\RecommendationsClient.tsx"
```

You're adding a Download button in the same horizontal row as the existing "צור מחדש" button. The button triggers a navigation/fetch to `/api/report/pdf` which streams the PDF.

- [ ] **Step 3: Edit the component**

Two changes:
1. Above the `cachedNote` div, surface a download row that's always visible when `data.rankings.length > 0`.
2. Or add the Download button alongside the regenerate button inside the cached banner.

Simpler: always show download when there are rankings. Add this block above `<ThreePathsView ...>`:

```tsx
{data.rankings.length > 0 && (
  <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
    <div className="text-muted-foreground">{he.report.title}</div>
    <Button asChild size="sm" variant="outline">
      <a href="/api/report/pdf" download>{he.recommendations.downloadPdf}</a>
    </Button>
  </div>
)}
```

(Use `<a download>` because the response sets `Content-Disposition: attachment`. The browser handles the download.)

- [ ] **Step 4: Verify TS + build**

```powershell
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```powershell
git add components/recommendations/RecommendationsClient.tsx lib/i18n/he.ts
git commit -m "feat(ui): download PDF button on /recommendations"
```

---

## Task 12: Manual E2E verification

**Files:** none (verification only)

- [ ] **Step 1: Run dev server**

```powershell
npm run dev
```

- [ ] **Step 2: Ensure you have a recommendation** — visit `/chat`, send 1-2 turns; visit `/assessment` and take at least one assessment; visit `/recommendations` and let it generate.

- [ ] **Step 3: Download the PDF** — on `/recommendations`, click "הורד דוח PDF". File downloads as `careeros-report-YYYYMMDD.pdf`.

- [ ] **Step 4: Open the PDF and visually verify**

Check every page:
- **Cover page**: brand at top, title + subtitle, generated date, disclaimer box at bottom, all RTL
- **Page 2**: ProfileMirror shows what the user actually shared (not all-null/missing). ThreePaths shows the 3 cards with their Hebrew prose.
- **Page 3**: RankingsTable shows top-5 occupations each with: title, description, total score, per-dimension bars (only the dimensions that have data — missing ones absent). FollowUps shows 4 numbered items.
- **Footer disclaimer** appears on pages 2 and 3 (and cover has its own).
- **Page numbers** "1 / 3", "2 / 3", "3 / 3" centered at bottom.
- **Hebrew renders cleanly** — no missing-glyph boxes anywhere. Mixed content (Hebrew + numbers + Latin) reads correctly.

- [ ] **Step 5: Re-download with no recommendation**

Open an Incognito window, visit `/api/report/pdf` directly (no recommendation should exist for this fresh anon user). Expected: 400 with `{"error":"no_recommendation"}`.

- [ ] **Step 6: Push branch + open PR**

```powershell
git push origin feat/phase-5a-pdf-report
gh pr create --base feat/phase-4-matching-engine --title "Phase 5a: PDF report" --body "..."
```

(Same `gh-token-via-tmotti77` pattern from earlier phases.)

---

## 5. Definition of Done

- [ ] `npm install` adds `@react-pdf/renderer`
- [ ] Heebo fonts in `public/fonts/` (3 weights)
- [ ] Spike PDF rendered and visually verified before continuing
- [ ] All 6 sections (Cover, ProfileMirror, ThreePaths, RankingsTable, FollowUps, DisclaimerFooter) implemented
- [ ] `ReportDocument` composes them into 3-page PDF
- [ ] `GET /api/report/pdf` returns the PDF with correct headers
- [ ] Download button on `/recommendations` triggers a real download
- [ ] Manual E2E passes — visual quality of the generated PDF is good enough to share
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] CLAUDE.md updated with Phase 5a notes
- [ ] PR opened against `feat/phase-4-matching-engine` (or `main` if Phase 4 has merged)

---

## 6. Known follow-ups (not blocking Phase 5a merge)

1. **30-day plan** (Phase 5b): templates + LLM customization + checkable UI
2. **Save report / auth upgrade** (Phase 5c): anonymous → registered conversion + email link
3. **Hebrew expert review** of the report's section text (Phase 7 launch checklist)
4. **PDF download analytics event** (Phase 6 polish): `report_downloaded` for funnel measurement
5. **HTML view of report** for users on email/SMS who can't open PDF (Phase 5c polish)
6. **"Less-recommended roles + why"** section (Phase 5 polish — needs the LLM to identify which low-scoring roles to flag)
7. **Per-report stable URL** when save-flow lands (Phase 5c) — replace `/api/report/pdf` with `/api/report/[id]/pdf`
8. **Visual regression tests** of the rendered PDF — `playwright` or `pdf-diff` if user testing flags layout drift
9. **Bold/semibold use audit** — first user feedback will tell us if the typography hierarchy reads right; tweak `styles.ts` then
10. **Long-text overflow** — Phase 4 prose is capped at 900 chars; if it ever grows, RankingsTable rows may need `wrap` adjustment
