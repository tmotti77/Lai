# CareerOS — Phase 5c: Save Report + Auth Upgrade

**Goal:** Let users save their recommendation/plan/report by signing in. The "save" event is the funnel conversion (master roadmap §22 KPI). Anonymous → registered upgrade is **already wired in Phase 1** (`lib/anonymous.ts` promotes the row in place when an auth_id appears for the first time, preserving all conversations / recommendations / plans / assessments). Phase 5c just adds the *surface*: a dialog on `/recommendations` and (later) `/plan` where the user enters email, gets a magic link, returns signed-in.

**Architecture:** No new tables, no new auth provider, no email service. Reuses Phase 1's Supabase magic-link OTP flow + `/auth/callback` route. The only new code is UI: a `SaveReportDialog` component (email form + Google button) reusable from anywhere we want to convert anonymous users. Trigger: "שמור דוח" button on `/recommendations` (visible to anonymous users only).

---

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Auth provider | **Supabase magic-link (already configured)** | Phase 1 setup; no new code needed. |
| Email delivery | **Supabase Auth sends the magic link** | No need for Resend. The link redirects to `/auth/callback?next=/recommendations` after sign-in. |
| Promotion | **In-place UPDATE in `lib/anonymous.ts`** (already exists) | Phase 1 invariant: anonymous users keep their data on first sign-in. |
| Show on | **`/recommendations` only** for Phase 5c | `/plan` and the chat could surface it too later. Start with the conversion event closest to the artifact. |
| Visibility | **Only when user is anonymous** | Already-signed-in users don't see "Save Report" — they see a "saved" badge instead. |
| Confirmation UX | **Dialog with email input + Google button + magic-link-sent state** | Same shape as `/sign-in` page; just compact in a Dialog. |
| Anonymous data retention | **Already handled** by `getOrCreateAnonymousUserId` | When the same user clicks the magic link, their existing anonymous row is promoted; their recommendations and plans stay attached automatically. |
| Email-the-report-link feature | **Out of scope** | The magic link IS the email — clicking it lands them on `/recommendations` where they can re-download. A separate "email me the PDF" feature is Phase 5c.5 polish. |

---

## 2. Tasks

### Task 1: i18n strings

Add `saveReport` block under `recommendations` in `lib/i18n/he.ts`:

```ts
saveReport: {
  cta: "שמור דוח",
  alreadySaved: "שמור בחשבון שלך",
  dialog: {
    title: "שמור את הדוח שלך",
    body: "תזין מייל ותקבל קישור התחברות. כל ההמלצות והתוכנית שלך יישמרו אצלך לחזור אליהן בעוד חצי שנה.",
    emailLabel: "אימייל",
    sendMagicLink: "שלח קישור התחברות",
    sending: "שולח…",
    sent: "שלחנו לך מייל עם קישור. בדוק את תיבת הדואר.",
    googleSignIn: "המשך עם Google",
    or: "או",
    invalidEmail: "אימייל לא תקין",
    cancel: "ביטול",
  },
},
```

### Task 2: SaveReportDialog component

`components/recommendations/SaveReportDialog.tsx`:
- Radix Dialog (we already use `@radix-ui/react-dialog`)
- Email input + "Send magic link" button
- "Continue with Google" button
- Sent-state confirmation
- All strings from i18n
- Reuses pattern from `app/(auth)/sign-in/page.tsx`
- Magic link redirects to `${origin}/auth/callback?next=/recommendations`

### Task 3: Wire on RecommendationsClient

Modify `components/recommendations/RecommendationsClient.tsx`:
- Read `supabase.auth.getUser()` on mount to know if user is signed-in
- If anonymous → show "שמור דוח" button alongside Download PDF + Generate Plan
- Clicking button opens `<SaveReportDialog />`
- If signed-in → show a small "✓ שמור בחשבון שלך" badge instead

### Task 4: Auth callback `next` param support

Read `app/(auth)/auth/callback/route.ts`. If it doesn't already support a `next` query param for post-sign-in redirect, add it (otherwise the user gets dropped back at `/` instead of `/recommendations`).

### Task 5: CLAUDE.md + push + PR

---

## 3. Definition of Done

- [ ] Anonymous user on `/recommendations` sees "שמור דוח" button
- [ ] Clicking opens dialog; submitting email triggers magic-link send
- [ ] Following the magic link lands user at `/recommendations` signed-in
- [ ] Their recommendations / plan are intact (Phase 1 promotion working as expected)
- [ ] Already-signed-in users see a "saved" badge instead of the button
- [ ] tsc + build pass
- [ ] PR opened

---

## 4. Known follow-ups (post-5c)

- Email the actual PDF as an attachment (needs Resend or Supabase Email Templates customization)
- "Send report to my career counselor" feature
- Reminder emails 30 days later
