# Development Workflow

> This document describes the quality-and-review pipeline for CareerOS. All changes (features, fixes, refactors) follow this process.

## Pipeline Overview

```
1. Issue/Spec → 2. Opus Plan → 3. Codex Critique → 4. Tests First → 5. Implementation → 6. Local Review → 7. CI → 8. Merge
```

## Step-by-Step

### 1. Issue/Spec

Every change starts with an issue or spec document:

- **Feature**: spec doc in `docs/superpowers/specs/`, referenced in issue
- **Bug**: issue with repro steps, expected vs actual behavior
- **Refactor**: issue with motivation (why now?) and success criteria

**Output**: GitHub issue with clear acceptance criteria

---

### 2. Opus Plan

Opus (or Claude Sonnet) creates a detailed implementation plan:

```bash
claude -p "Read issue #<N>, create implementation plan in docs/plans/<issue>.md"
```

**Plan must include**:

- Problem statement (reference issue)
- Proposed solution (architecture, files to change)
- Tests to write (test-first approach)
- Risks & edge cases
- Rollback plan (if touching critical paths)

**Output**: `docs/plans/<issue>.md` committed to a feature branch

---

### 3. Codex Plan Critique

Codex reviews the plan BEFORE implementation:

```bash
codex exec review-plan --plan docs/plans/<issue>.md
```

**Codex checks**:

- [ ] Plan addresses issue requirements
- [ ] Approach is consistent with architecture (see CLAUDE.md)
- [ ] Tests are sufficient and specific
- [ ] Edge cases identified
- [ ] No architectural violations (e.g., LLM for deterministic logic)

**Output**: `docs/plans/<issue>-critique.md` committed alongside plan

---

### 4. Tests First

Write tests BEFORE implementation (TDD):

1. **Create test file**: `tests/unit/<feature>.test.ts` or `tests/integration/<feature>.test.ts`
2. **Write failing tests**: based on plan acceptance criteria
3. **Commit tests**: `git commit -m "test: add tests for <feature>"`
4. **Push**: `git push -u origin <branch>`

**Run locally**:

```bash
npm test -- <test-file>  # single file
npm test                  # all tests
```

**Output**: Committed test files (red, but structured correctly)

---

### 5. Implementation

Implement the feature/fix to make tests pass:

1. **Follow plan**: implement as specified (or update plan if approach changes)
2. **Check quality**: run lint + typecheck as you go
3. **Verify tests pass**: `npm test` (all tests green)
4. **Push WIP commits**: after each logical step (don't wait for perfection)

**Example commit messages**:

```
feat: add CV skill extraction endpoint

fix: handle missing ANTHROPIC_API_KEY in tests

refactor: extract safety check into lib/ai/safety
```

**Output**: Implementation commits on feature branch

---

### 6. Local Review (Codex)

Before opening PR, run Codex review locally:

```bash
timeout 30m codex exec review --branch <branch-name>
```

**Codex reviews** (see AGENTS.md § Code Review Rules):

- Architectural compliance
- Test coverage
- Type safety
- Security (no secrets, safety checks present)
- Style consistency

**Codex outputs**:

- `runs/<run-id>/status.json` (done/failed)
- `runs/<run-id>/review.md` (detailed feedback)
- PR comment (summary)

**Fix issues**, then re-run review if needed.

**Output**: Codex approval (or resolved feedback)

---

### 7. CI

Push triggers GitHub Actions (`.github/workflows/ci.yml`):

```yaml
jobs:
  test:
    - npm run lint        # ESLint
    - npx tsc --noEmit    # Type checking
    - npm test            # Vitest
    - npm run build       # Next.js build
```

**Also runs** (if configured):

- `claude-review.yml` — Claude Code review (requires `CLAUDE_CODE_OAUTH_TOKEN`)
- GitHub Codex — Automatic code review via ChatGPT (requires Codex enabled in repo settings)

**All must pass** (green checkmarks).

**Output**: CI status on PR (green = good to merge)

---

### 8. Merge

Moti (repo owner) reviews and merges:

1. **Check PR template** (boxes ticked):
   - [ ] Plan committed
   - [ ] Plan critique committed
   - [ ] Tests written first
   - [ ] Codex approved
   - [ ] CI green
2. **Manual review** (quick skim, trust automation)
3. **Merge** via GitHub UI (squash & merge preferred)

**Output**: Changes on `main`, PR closed

---

## Reliability Rules

### For Autonomous Runs

All headless agent runs MUST:

1. **Wrap with timeout**: `timeout <duration> <command>`
2. **Write status file**: `runs/<run-id>/status.json`

   ```json
   {
     "status": "done" | "failed" | "timeout",
     "timestamp": "2026-10-11T17:40:00Z",
     "message": "Completed plan implementation"
   }
   ```

3. **Write log file**: `runs/<run-id>/log.txt` (redirect stdout/stderr)
4. **Push WIP commits**: after each step (plan → tests → implementation → fixes)
5. **End with comment**: post summary to issue/PR

**Example**:

```bash
timeout 1h claude -p --max-turns 20 "Implement issue #42" > runs/abc123/log.txt 2>&1
echo '{"status":"done","timestamp":"2026-10-11T17:40:00Z","message":"Issue #42 implemented"}' > runs/abc123/status.json
git add . && git commit -m "feat: implement issue #42" && git push
gh pr comment <PR> --body "✅ Implementation complete. See runs/abc123/log.txt for details."
```

### For Codex Review

All `codex exec review` runs MUST:

1. **Wrap with timeout**: `timeout 30m codex exec review`
2. **Write status**: `runs/<run-id>/status.json` (done/failed)
3. **Write feedback**: `runs/<run-id>/review.md` (detailed)
4. **Post to PR**: comment with summary + link to detailed review
5. **Exit code**: 0 for approve, 1 for request changes

**Example**:

```bash
timeout 30m codex exec review --branch feature-x > runs/def456/log.txt 2>&1
EXIT_CODE=$?
echo '{"status":"done","timestamp":"2026-10-11T17:40:00Z","exit_code":'$EXIT_CODE'}' > runs/def456/status.json
gh pr comment <PR> --body-file runs/def456/review.md
exit $EXIT_CODE
```

---

## Special Cases

### Hotfix (urgent production issue)

1. **Skip plan**: create issue, implement directly with tests
2. **Abbreviated review**: Codex review only (skip Claude)
3. **Fast-track merge**: Moti approves immediately if CI green
4. **Retroactive plan**: document what was done (for audit trail)

### Refactor (no behavior change)

1. **Plan required**: justify why now, what improves
2. **Tests unchanged**: existing tests must still pass (no new tests needed)
3. **Snapshot tests**: if changing component structure, update snapshots
4. **Rollback ready**: keep refactor in single PR (easy to revert)

### Documentation (no code change)

1. **Skip Codex review**: not needed for pure docs
2. **Skip CI tests**: lint + build still run (verify markdown/links)
3. **Self-merge allowed**: Moti can merge without review

---

## Branch & PR Rules

### Branch Naming

- `cursor/<descriptive-name>-1d88` (for agent-created branches)
- `feature/<descriptive-name>` (for human-created branches)
- `fix/<issue-number>-<short-desc>` (for bug fixes)
- `refactor/<short-desc>` (for refactors)

### PR Size

- **Target**: 100-400 lines changed
- **Max**: 800 lines (need justification in description)
- **Split large changes**: multiple PRs (plan → tests → implementation, or by feature slice)

### PR Title

- Conventional Commits style: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Clear and specific: "feat: add CV skill extraction" not "add feature"

### PR Description

Use template (`.github/pull_request_template.md`):

- [ ] Plan committed
- [ ] Plan critique committed
- [ ] Tests written first
- [ ] Local `codex exec review` passed
- [ ] CI green

Plus:

- Link to issue: `Closes #<N>`
- Summary: what changed, why
- Testing: how to verify
- Risks: any known issues or rollback notes

---

## Branch Protection (Manual Setup)

Moti must configure via GitHub Settings → Branches → `main`:

- ✅ **Require PR** before merging
- ✅ **Require status checks** to pass: `test` (CI)
- ✅ **Dismiss stale approvals** when new commits pushed
- ✅ **Require conversation resolution** before merge
- ✅ **Block force push**
- ✅ **Require linear history** (squash or rebase, no merge commits)

---

## Review Integration (Manual Setup)

Moti must configure:

### 1. Claude Code Review (OAuth)

```bash
# On local machine with Claude Code subscription
claude setup-token
# Copy the generated token
```

Then add to GitHub Settings → Secrets and variables → Actions:
- Secret name: `CLAUDE_CODE_OAUTH_TOKEN`
- Value: paste token from `claude setup-token`

**Workflow skips gracefully** when token missing, so CI stays green until configured.

### 2. Codex Automatic Code Review

Enable via GitHub repo Settings → Code security and analysis → ChatGPT Codex:
- ✅ Enable Codex automatic code review
- **Review rules**: Codex will read `AGENTS.md § Code Review Rules` automatically
- Posts inline comments on PRs (no workflow file needed)

**Free with GitHub Copilot subscription** (included in Copilot Individual/Business/Enterprise).

---

## Questions?

- **Workflow not clear?** Open issue with `docs` label
- **Tool broken?** Open issue with `bug` label
- **Want to propose change?** Create spec doc → follow this workflow 😉
