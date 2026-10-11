## Description

<!-- Brief summary of what this PR does and why -->

Closes #<!-- issue number -->

## Checklist

### Planning & Review

- [ ] **Plan committed**: `docs/plans/<issue>.md` includes problem, solution, tests, risks
- [ ] **Plan critique committed**: Codex reviewed plan in `docs/plans/<issue>-critique.md`
- [ ] **Tests written first**: Test files committed before implementation (TDD)

### Code Quality

- [ ] **Local Codex review passed**: Ran `codex exec review` and addressed feedback
- [ ] **CI green**: All checks passed (lint, typecheck, tests, build)
- [ ] **No secrets committed**: No API keys, tokens, or credentials in code
- [ ] **Type safety**: No `any` types without justification
- [ ] **Hebrew strings in i18n**: All user-facing text in `lib/i18n/he.ts`

### Architecture Compliance

- [ ] **Deterministic logic**: Matching/scoring logic is TypeScript, not LLM-generated
- [ ] **Safety checks present**: `checkUserMessage` runs on user-facing LLM routes
- [ ] **Consent enforcement**: `requireConsent` called on mutation routes
- [ ] **Service-role client**: DB writes use service-role, not anon-key
- [ ] **Prompt caching**: Configured via `providerOptions.anthropic.cacheControl`

### Testing

- [ ] **Tests pass locally**: `npm test` succeeds
- [ ] **Coverage sufficient**: Critical paths (matching, safety, consent) have tests
- [ ] **Edge cases covered**: Tests include error cases, boundary conditions

### Size & Scope

- [ ] **PR size reasonable**: ≤800 lines changed (excluding generated/config files)
- [ ] **Single concern**: PR addresses one issue/feature (split if too large)

## Testing Instructions

<!-- How to manually verify this change works -->

1. ...
2. ...

## Risks & Rollback

<!-- Any known issues or rollback notes? Mark N/A if low-risk change -->

- **Risks**: ...
- **Rollback**: ...

## Screenshots/Recordings (if applicable)

<!-- For UI changes, include before/after screenshots or screen recordings -->

---

**For reviewers**: This PR follows the workflow in `docs/WORKFLOW.md`. Check that all boxes are ticked before approving.
