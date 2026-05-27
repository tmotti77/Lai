# Launch Expert-Review Packet

**Status:** the three items below are the *only* remaining blockers between the current
closed-beta-ready build and an unrestricted public launch. Each requires a credentialed
human; none can be closed by engineering. This packet exists to shrink each reviewer's job
from "produce" to "approve" — the content is already written, reviewed for mechanical
defects, and live. The reviewer's job is verification and sign-off, not authorship.

Last engineering pass: 2026-05-27. Scope reference:
`docs/superpowers/specs/2026-05-20-career-os-07a-launch-readiness-design.md` (these are the
items that spec explicitly defers to 7b / public launch).

---

## 1. Psychologist sign-off — assessment items

**Files:** `lib/assessment/riasec/items.ts`, `lib/assessment/big5/items.ts`,
`lib/assessment/values/options.ts`, `lib/assessment/constraints/schema.ts`

**What was done (engineering pass):** all items read line-by-line for mechanical
psychometric defects.
- RIASEC (30 items, now `RIASEC_ITEMS_VERSION = 2`): fixed **R5** (was a grammatically
  incomplete sentence — missing verb) and **A2** (was double-barreled, mixing flexibility
  with self-expression; flexibility already loads on A4, so A2 narrowed to pure
  self-expression).
- Big5 (20 items, IPIP-NEO short form): 4 per trait, 2 keyed + 2 reverse-keyed for
  acquiescence control. No mechanical defects found.
- Values (12 options): clean.
- Constraints: a bounded form, not a scored instrument — no item-validity question.

**What needs the psychologist (cannot be done in code):**
- Construct validity: do the Hebrew items actually measure RIASEC / the Big Five as
  intended for an Israeli post-army / pre-studies population?
- Cultural appropriateness and reading level for the target users.
- Confirm the IPIP-NEO paraphrases stay within the open-license intent and don't drift into
  any proprietary instrument's wording.
- Sign-off that presenting these as guidance (never as clinical diagnosis) is defensible.

**Why a person is required:** item validity is an empirical/clinical judgment about latent
constructs. No static analysis substitutes for it.

---

## 2. Lawyer review — disclaimer & legal pages

**Files:** disclaimer strings in `lib/i18n/he.ts` (`disclaimer.short` / `.long`,
`report.disclaimer.cover` / `.footer`); surfaced in `components/chat/DisclaimerBanner.tsx`,
`lib/pdf/sections/Cover.tsx`, `lib/pdf/sections/DisclaimerFooter.tsx`,
`lib/ai/prompts/system.ts`; legal pages `app/(marketing)/terms/page.tsx` and
`app/(marketing)/privacy/page.tsx`.

**What was done (engineering pass):** verified the disclaimer is present and substantive in
all four required surfaces (chat banner, PDF cover + footer, T&C, system prompt). Current
text explicitly states the system is not a psychological assessment, not therapeutic or
legal counsel, and not a guarantee of employment outcomes, and redirects users in distress
to a professional.

**What needs the lawyer (cannot be done in code):**
- Confirm the disclaimer wording is legally sufficient under Israeli consumer / liability
  law for an AI guidance product.
- Review T&C and privacy pages for completeness (data processing basis, retention, user
  rights, age, governing law).
- Decide whether a cookie/analytics consent banner is required before closed beta (the 7a
  spec leaves this as an explicit legal escape hatch — see spec row 2).

**Why a person is required:** legal sufficiency is a licensed judgment, jurisdiction-specific.

---

## 3. Domain-expert review — occupation catalog

**Files:** `content/occupations/*.json` (50 entries),
`content/skills/taxonomy.json` (88 skills). Data source tag: `public_knowledge_v1`.

**What was done (engineering pass):** salary ranges sanity-checked against publicly known
Israeli market norms across all 50 occupations — no glaring outliers found.

**What needs the domain expert (cannot be done from public data alone):**
- Verify salary ranges, demand levels, AI-displacement risk, and training durations reflect
  the *current* Israeli market, not generic/global figures.
- Flag any occupation whose stated training path doesn't match real Israeli routes
  (e.g. specific bootcamps, certifications, degree requirements).

**Why a person is required:** these are market-current facts that a curated public-knowledge
snapshot can approximate but not certify.

---

## What is NOT blocked

Everything engineering. All 16 product surfaces are verified working in production; `tsc`,
`eslint`, and the unit/integration suite pass; main, the feature branch, and production are
in sync. The app is fully functional for closed-beta traffic today. The three items above
gate *unrestricted public* launch only.
