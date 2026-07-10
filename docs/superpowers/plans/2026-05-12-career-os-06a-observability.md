# CareerOS — Phase 6a: Observability (Sentry + Analytics)

**Goal:** wire production error tracking (Sentry) and product analytics (Vercel Analytics) **before** Phase 6b/6c add the interview simulator and feedback loops. Get to a state where every server error reaches a dashboard and every §22 funnel event fires automatically.

**Architecture:** No new tables. Two new SDKs (`@sentry/nextjs`, `@vercel/analytics`). Two env vars (`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`). Per-route error capture for the LLM-heavy endpoints (chat, cv/extract, recommendations, plan/generate, report/pdf). Event firing on a small `lib/analytics.ts` helper that wraps `track()` so the 8 KPI events from master roadmap §22 are first-class.

Phase 6 in the master roadmap bundles 9 deliverables across 2 weeks. We're splitting it the same way Phase 3 became 3a/3b and Phase 5 became 5a/5b/5c — smallest foundational piece first.

---

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Error tracking provider | **Sentry** | Roadmap §1 has it pre-decided. The `sentry` plugin is already available locally. Free tier covers MVP. |
| Analytics provider | **Vercel Analytics** | Hosting is already Vercel. `@vercel/analytics` is one SDK, zero infra. Plays nicely with Next.js App Router via `<Analytics />` component in root layout. |
| Error capture scope | **Server: all five LLM routes + middleware. Client: Sentry's automatic global handler only.** | Hebrew users on Israeli ISPs may surface region-specific issues. We want server errors with stage/conversation context, client errors only when they're catastrophic. |
| User identification | **`internalUserId` from `getOrCreateAnonymousUserId`**, never email or auth_id. | Anonymous-first funnel: most errors happen before sign-in. The internal UUID is stable and connectable to the `users` table for follow-up without exposing PII to Sentry. |
| PII scrubbing | **Strip all Hebrew message content before send to Sentry** | A user message could contain sensitive disclosures (mental-health distress, age, finances). Sentry should never see message bodies. Only metadata: conversation id, stage, route, error type, status code. |
| Analytics events | **8 events corresponding to master roadmap §22 funnel KPIs**, fired from server routes and client UI as appropriate (`chat_first_message`, `assessment_complete`, `recommendations_viewed`, `report_downloaded`, `plan_generated`, `task_completed`, `save_dialog_shown`, `signin_completed`). | These are the KPIs the master roadmap §5 commits to measuring. Less is more — adding more events later is easy; pruning is hard. |
| Source maps upload | **Yes, in production builds only** | Required for readable stack traces in Sentry. Vercel deploy plugin handles this if `SENTRY_AUTH_TOKEN` is set. |
| Session replay | **No** | Privacy + cost. Hebrew RTL also has known replay rendering glitches. Re-evaluate post-launch. |
| Tunnel route | **Yes (`/monitoring/sentry`)** | Israeli ad-blockers often block `*.sentry.io` directly. A first-party tunnel route routes Sentry traffic through our origin. Vercel Edge Functions handle this with zero config via `@sentry/nextjs`. |
| Cost monitoring | **Track LLM token usage in analytics events** (`assistant_turn` event with input/output/cache breakdown) | We're paying Anthropic per token. Phase 6a is the moment to start watching cost-per-conversation before Phase 6c adds 4 new LLM-driven interview personas. |

---

## 2. Tasks

### Task 1: Install + initial config

- `npm i @sentry/nextjs @vercel/analytics`
- `npx @sentry/wizard@latest -i nextjs --saas --org <org> --project careeros` to scaffold `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.ts` integration, and `app/global-error.tsx`.
- Set env vars on Vercel: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`.
- Add `tunnelRoute: "/monitoring/sentry"` to `withSentryConfig(...)` options.
- Mount `<Analytics />` in `app/layout.tsx` (Vercel Analytics; auto-tracks page views).

### Task 2: PII scrubber

`lib/observability/sentry.ts`:
- `beforeSend(event)` hook that strips `message.parts`, request bodies, and any field matching `/text|content|message|body|input/i` from the event payload.
- Allow-list metadata: `conversationId`, `stage`, `safetyFlag`, `route`, `internalUserId` (the anonymous UUID — not auth_id), `errorType`, status code.
- Unit test with 4 fixture events covering chat / extract / safety / unknown shape.

### Task 3: Server route error capture

For each LLM route, wrap the body in `Sentry.startSpan(...)` and explicitly `Sentry.captureException` on caught errors with stage/conversationId tags:
- `app/api/chat/route.ts`
- `app/api/cv/upload/route.ts`
- `app/api/cv/extract/route.ts`
- `app/api/cv/confirm/route.ts`
- `app/api/recommendations/route.ts`
- `app/api/plan/generate/route.ts`
- `app/api/report/pdf/route.ts`

Sentry tag scheme:
- `route` — Next.js route segment
- `stage` — current `conversations.stage` if applicable
- `conversation_id` — UUID
- `internal_user_id` — UUID
- `error_kind` — `pdf_parse_failed | empty_text | llm_timeout | db_failed | safety_short_circuit | unknown`

### Task 4: Analytics helper + event firing

`lib/analytics.ts`:
```ts
export type AnalyticsEvent =
  | { name: "chat_first_message"; conversationId: string }
  | { name: "assessment_complete"; type: "riasec" | "big5" | "values" | "constraints" }
  | { name: "recommendations_viewed"; profileHash: string; cached: boolean }
  | { name: "report_downloaded" }
  | { name: "plan_generated"; archetype: string }
  | { name: "task_completed"; week: number; day: number }
  | { name: "save_dialog_shown" }
  | { name: "signin_completed"; provider: "magic_link" | "google" }
  | { name: "assistant_turn"; stage: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number };
export function track(event: AnalyticsEvent): void { ... }
```

The `track()` helper uses `@vercel/analytics`'s server-side `track()` from `@vercel/analytics/server`. Event payload is a flat object (Vercel Analytics doesn't support nested objects).

Fire each event at its natural site:
- `chat_first_message` — chat route, when `loadMessages(conversation.id)` returns 0 prior messages.
- `assistant_turn` — chat route `onFinish` callback (alongside existing console.log).
- `assessment_complete` — assessment submit route, on successful insert.
- `recommendations_viewed` — recommendations GET route, server-side render.
- `report_downloaded` — `/api/report/pdf` route, before stream.
- `plan_generated` — `/api/plan/generate` route, on success.
- `task_completed` — `/api/plan/task/[id]` route, on `done: true` toggle.
- `save_dialog_shown` — `<SaveReportDialog>` client component on open.
- `signin_completed` — `/auth/callback` route, on successful session creation.

### Task 5: Vercel dashboard wiring

- Vercel project → Integrations → install Sentry integration (auto-injects env vars).
- Sentry project → set alert rules: any 500 / any `error_kind: db_failed` / >5 errors/min from the chat route.
- Vercel Analytics dashboard → create custom funnel view for the 8 events.

### Task 6: Local dev affordance

- `.env.local.example` adds `SENTRY_DSN=` (commented; optional in dev).
- When `SENTRY_DSN` is empty, the SDK no-ops and `track()` logs to console instead. Devs aren't required to set Sentry up for local work.

### Task 7: Verification

- Manually throw an error in `app/api/cv/upload/route.ts` behind `if (req.headers.get("x-debug-error")) throw new Error("test")` and confirm it lands in Sentry with the right tags.
- Send a chat message and confirm `assistant_turn` shows up in Vercel Analytics within 1 minute.
- Remove the test-error header check before merge.

---

## 3. Out of scope (for Phase 6a)

- **Session replay** — privacy-sensitive (Hebrew personal disclosures); revisit post-launch.
- **Custom Sentry dashboards** — use the default views first; build dashboards once we have a month of real data.
- **Database query tracing** — Supabase has its own logs panel. Adding OpenTelemetry to all DB calls is Phase 7 if needed.
- **Rate limiting / abuse detection** — Phase 7 (compliance + launch prep).
- **PostHog or product analytics beyond Vercel** — Vercel Analytics is sufficient for §22 KPIs. Switching is a 30-min job later if we need session affinity / cohort analysis.

---

## 4. Success criteria

- All five LLM routes emit Sentry events on uncaught errors with stage + conversationId tags
- No raw user message text reaches Sentry (verified by inspecting captured events for at least one of each route's errors)
- All 8 funnel events fire in dev and reach Vercel Analytics in production
- Sentry `tunnelRoute` works end-to-end (verified by blocking `sentry.io` in browser dev tools and confirming events still flow)
- Local dev with empty `SENTRY_DSN` does not throw or warn
- Source maps upload on Vercel production deploy (verified by checking that a Sentry-captured production error shows file:line of actual source, not the bundled output)

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Sentry SDK adds significant bundle size to client | Use `withSentryConfig` defaults (lazy-loaded, ~30KB gzipped). Re-measure with Lighthouse post-install. |
| PII leaks via stack traces (e.g. an Error message containing user text) | The `beforeSend` hook scrubs by field name AND by content heuristic (strip any string > 200 chars from event payload). Add a unit test fixture that constructs an Error whose message includes a Hebrew sentence and confirms it's redacted. |
| Vercel Analytics doesn't capture server-side events on edge | We're on Node runtime everywhere already (per `runtime = "nodejs"` exports), so this isn't a problem today. Document in `lib/analytics.ts` that the helper assumes Node. |
| Cost monitoring shows surprises (Hebrew tokens are 2× English) | Already-planned `assistant_turn` event captures input/output/cache tokens per turn. Build a simple Vercel Analytics filter to see cost-per-user per day within week 1 of merge. |

---

## 6. Follow-up phases

After 6a lands, the suggested sub-phase order is:

- **6b** — Feedback loops (thumbs + NPS + `feedback` table). Smallest user-facing surface; uses observability primitives from 6a.
- **6c** — Interview simulator (HR/technical/first-job/negotiation modes). The big new feature; needs 6a's observability because it adds 4 new LLM personas.
- **6d** — Cross-cutting polish (a11y, mobile, empty states). Quality bar lift; goes last when the surface is stable.

Each sub-phase gets its own plan file when it's about to be started, following this same shape.
