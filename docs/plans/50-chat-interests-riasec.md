# Plan: derive interests from chat when formal RIASEC is missing (#50)

## Problem (from #50)

`buildMatchingProfile` (`lib/matching/profile.ts`) set `profile.interests` only from the formal RIASEC
assessment. Chat-only users got `interests: null`, so the 25%-weight interests dimension was dropped.
Production showed `interests` null in 52 of 56 recommendations.

## Acceptance criteria (verbatim from #50)

- Formal RIASEC present → used unchanged (regression test)
- No formal RIASEC, chat interests present → non-null interests vector, deterministic for same input
- Neither present → `null` and the scorer's existing reweighting still works
- Confidence of extracted interests is respected (e.g. low-confidence weighted down)
- Unit tests in `tests/unit/` cover all cases; CI `test` green

## Context map

| What | Where |
|---|---|
| Profile builder | `lib/matching/profile.ts` `buildMatchingProfile` |
| Chat interest shape | `lib/ai/extraction.ts` `InterestSchema`: `{label, label_he, evidence, confidence}` |
| Consumer | `lib/matching/score/interests.ts`: cosine similarity vs `occupation.riasec_affinity` (scale-invariant) |
| Other reader | `lib/pdf/sections/ProfileMirror.tsx`: top letter under "תחומי עניין דומיננטיים", honest for a derived vector |
| Cache key | `lib/matching/hash.ts`: hash over the built profile, so derived interests recompute affected caches |

## Design

Options considered:

1. **Keyword lexicon at match time** (chosen). Deterministic, no LLM, works on all existing rows.
2. Tag a RIASEC letter per interest during extraction. More accurate for new chats, but leaves the
   existing 52 rows null and adds an LLM classification step to the extraction schema. Possible follow-up.

Lexicon rules (`lib/matching/interestsFromChat.ts`):

- English `label`: whole word, case-insensitive; `*` = word prefix.
- Hebrew `label_he`: stem at word start, after up to two prefix letters (ו ה ב ל מ ש כ). Plain stems ending
  in ה also match the construct form in ת. Specific exclusions via lookahead (סדר not סדרה, שטח not שטחי).
- Weight per interest = confidence (high 1, medium 0.6, low 0.3; unknown → medium), split evenly across
  matched letters. Sum, then scale so the max letter is 100. All zero → `null`.

## Steps

1. Failing tests for every acceptance criterion plus false-positive guards (נאמנות, פיקוד, סדרות, משרד הביטחון).
2. Implement `riasecFromChatInterests`; wire into `buildMatchingProfile` behind formal RIASEC.
3. Probe with realistic Hebrew labels; fix misses (construct form, app development, information security).
4. tsc, lint, unit suite, build.

## Out of scope

- Per-interest RIASEC tagging at extraction time (option 2).
- Measuring the null-share drop in production. Needs the career-os project unpaused; query:
  `select count(*) filter (where (profile->'interests') is null), count(*) from recommendations where created_at > <deploy>`.
