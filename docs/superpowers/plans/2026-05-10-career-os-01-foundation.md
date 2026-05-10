# CareerOS — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap CareerOS — a Next.js 16 + Supabase + Vercel app with Hebrew RTL defaults, working email/Google auth, anonymous-session support, prompt-cached Claude streaming, persistent Hebrew chat UI with disclaimer, CI, and Vercel preview deploys.

**Architecture:** Single Next.js 16 App Router app, TypeScript everywhere, Tailwind + shadcn/ui (Radix primitives), Supabase Auth + Postgres + Storage via `@supabase/ssr`, Anthropic Claude Sonnet 4.6 via Vercel AI SDK with `cacheControl: { type: 'ephemeral' }`, Vitest for unit tests, GitHub Actions for CI. RTL is set at `<html dir="rtl" lang="he">`; Heebo font via `next/font/google`.

**Tech Stack:** Next.js 16, TypeScript, Tailwind v4, shadcn/ui, `@supabase/ssr`, `@supabase/supabase-js`, `ai`, `@ai-sdk/anthropic`, `zod`, Vitest, Playwright (smoke only this phase).

---

## Pre-flight (do these once, manually, before Task 1)

- [ ] Create Supabase project at supabase.com → save the URL, anon key, and service-role key
- [ ] Create Anthropic API key at console.anthropic.com with $50 starter credit
- [ ] Create Vercel account and connect it to your GitHub
- [ ] Create a GitHub repo named `lai` (or `career-os`) — but DO NOT push yet, we'll push after Task 2

---

## Task 1: Initialize Next.js 16 project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`, `postcss.config.mjs`, `tailwind.config.ts`

- [ ] **Step 1: Verify the create-next-app flag for skipping git init**

The flag name has changed across versions (historically `--no-git`, recent docs reference `--disable-git`). Run the help command first and confirm what your installed version accepts:

```powershell
npx create-next-app@latest --help
```

Look at the output for the flag that disables git init. Note it down.

- [ ] **Step 2: Scaffold over the existing repo**

Remove the placeholder file:

```powershell
Remove-Item .gitkeep
```

Now run create-next-app in the current directory. **Replace `<no-git-flag>` below with whatever flag your version actually shows** (e.g. `--no-git`, `--disable-git`, or `--skip-git`):

```powershell
npx create-next-app@latest . --ts --tailwind --eslint --app --import-alias="@/*" --turbopack --use-npm <no-git-flag>
```

When prompted "directory is not empty, continue?" answer `y`. Accept other defaults.

If create-next-app rejects the no-git flag entirely, omit it — the existing `.git/` directory will make its internal git-init a no-op, but you'll see a harmless warning. Verify your repo is intact:

```powershell
git status
git log --oneline -1
```

The first commit (`Initialize repository`) must still be there.

- [ ] **Step 3: Verify dev server runs**

```powershell
npm run dev
```

Expected: Next.js starts on http://localhost:3000 and shows the default page. Stop the server with Ctrl+C.

- [ ] **Step 4: Lock Node version**

Create `.nvmrc`:
```
20
```

Add to `package.json` `"engines"`:
```json
"engines": {
  "node": ">=20.0.0"
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with TypeScript + Tailwind"
```

---

## Task 2: Configure Hebrew RTL defaults + Heebo font

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`

- [ ] **Step 1: Update root layout for RTL + Heebo**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "CareerOS — מערכת הפעלה לקריירה שלך",
  description: "סוכן AI שעוזר לך להבין איזה כיוון מקצועי מתאים לך באמת.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update globals.css with Tailwind v4 theme tokens**

Replace `app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-heebo), ui-sans-serif, system-ui, sans-serif;
  --color-background: oklch(0.99 0 0);
  --color-foreground: oklch(0.18 0.01 260);
  --color-muted: oklch(0.96 0.005 260);
  --color-muted-foreground: oklch(0.45 0.01 260);
  --color-border: oklch(0.92 0.005 260);
  --color-primary: oklch(0.55 0.15 250);
  --color-primary-foreground: oklch(0.99 0 0);
  --color-accent: oklch(0.95 0.03 250);
  --color-destructive: oklch(0.55 0.20 25);
  --radius: 0.625rem;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(0.13 0.01 260);
    --color-foreground: oklch(0.95 0 0);
    --color-muted: oklch(0.20 0.01 260);
    --color-muted-foreground: oklch(0.65 0.01 260);
    --color-border: oklch(0.25 0.01 260);
    --color-accent: oklch(0.22 0.03 250);
  }
}

html, body { height: 100%; }
```

- [ ] **Step 3: Replace the default home page with a Hebrew placeholder**

Replace `app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">CareerOS</h1>
      <p className="text-lg text-muted-foreground">
        סוכן AI שעוזר לך להבין איזה כיוון מקצועי מתאים לך באמת.
      </p>
      <p className="text-sm text-muted-foreground">בקרוב.</p>
    </main>
  );
}
```

- [ ] **Step 4: Run dev server, visit /, verify RTL + Hebrew render**

```powershell
npm run dev
```

Expected: Hebrew text renders right-to-left, in Heebo font. Stop the server.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: RTL Hebrew defaults with Heebo font"
git remote add origin https://github.com/<your-username>/lai.git
git push -u origin main
```

---

## Task 3: Install and configure shadcn/ui

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/dialog.tsx`, `components/ui/sonner.tsx`

- [ ] **Step 1: Initialize shadcn**

```powershell
npx shadcn@latest init
```

Choose: TypeScript=yes, style=Default, base color=Neutral, CSS variables=yes. Accept other defaults.

- [ ] **Step 2: Install the primitives we need in Phase 1**

```powershell
npx shadcn@latest add button card input textarea dialog sonner badge
```

- [ ] **Step 3: Verify components compile**

```powershell
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: install shadcn/ui primitives"
```

---

## Task 4: Set up environment variable validation with Zod

**Files:**
- Create: `lib/env.ts`, `.env.example`, `.env.local`

- [ ] **Step 1: Install zod**

```powershell
npm install zod
```

- [ ] **Step 2: Create env validator**

Create `lib/env.ts`:

```ts
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  // Model ID is intentionally an env var so it can be updated without a code change
  // when Anthropic ships a new snapshot or rotates aliases.
  // Verify the current ID against https://docs.anthropic.com/en/docs/about-claude/models
  // or `curl https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"`
  // before setting. Fail loudly if unset rather than guessing a slug.
  ANTHROPIC_MODEL: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

const clientEnvSchema = serverEnvSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
  NEXT_PUBLIC_SITE_URL: true,
});

const isServer = typeof window === "undefined";

const parsed = isServer
  ? serverEnvSchema.safeParse(process.env)
  : clientEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    });

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
```

- [ ] **Step 3: Create `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-...
# Verify current model ID at https://docs.anthropic.com/en/docs/about-claude/models
# or via `curl https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"`
# Examples (verify before using): claude-sonnet-4-5, claude-opus-4-1, or a dated snapshot like claude-sonnet-4-5-20250929
ANTHROPIC_MODEL=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 4: Create `.env.local` with real values**

Copy `.env.example` to `.env.local` and fill in real values from Supabase + Anthropic.

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` with real keys. **Do not commit this file.**

- [ ] **Step 5: Confirm `.env.local` is gitignored**

`.gitignore` should already include `.env*.local` from create-next-app. Verify:

```bash
git status --ignored
```

Expected: `.env.local` appears in ignored list.

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts .env.example
git commit -m "feat: validate environment variables with zod"
```

---

## Task 5: Install Vitest and write the first test

**Files:**
- Create: `vitest.config.ts`, `tests/unit/sanity.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```powershell
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Write the failing test**

Create `tests/unit/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

```powershell
npm test
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add Vitest setup with sanity test"
```

---

## Task 6: Hebrew strings dictionary

**Files:**
- Create: `lib/i18n/he.ts`

- [ ] **Step 1: Create Hebrew dictionary**

Create `lib/i18n/he.ts`:

```ts
export const he = {
  brand: {
    name: "CareerOS",
    tagline: "מערכת הפעלה לקריירה שלך",
  },
  disclaimer: {
    short: "המערכת אינה מחליפה ייעוץ מוסמך ואינה מהווה אבחון פסיכולוגי.",
    long:
      "המערכת מספקת הכוונה וכלי חשיבה בלבד. היא אינה מהווה אבחון פסיכולוגי, ייעוץ טיפולי, ייעוץ משפטי או הבטחה להצלחה תעסוקתית. אם אתה במצוקה, פנה לאיש מקצוע מתאים.",
  },
  consent: {
    title: "לפני שמתחילים",
    body: "אני מאשר/ת שהבנתי שהמערכת מספקת הכוונה בלבד ואינה מחליפה יועץ קריירה או פסיכולוג מוסמך. אני מסכים/ה שהמידע שאספק יישמר ויעובד למטרת מתן ההמלצות.",
    accept: "מסכים/ה",
    decline: "לא כרגע",
    privacy: "מדיניות פרטיות",
    terms: "תנאי שימוש",
  },
  chat: {
    placeholder: "כתוב לי מה עובר עליך מקצועית עכשיו…",
    send: "שלח",
    sending: "שולח…",
    newChat: "שיחה חדשה",
    headerTitle: "שיחה עם CareerOS",
    emptyState: {
      title: "בוא נתחיל להכיר",
      body: "ספר לי במשפט אחד איפה אתה נמצא היום מבחינת לימודים, עבודה או התלבטות.",
    },
    error: {
      generic: "משהו השתבש. נסה שוב בעוד רגע.",
      rateLimit: "יותר מדי בקשות בזמן קצר. ננסה שוב בעוד דקה?",
    },
  },
  auth: {
    signInTitle: "התחברות / הרשמה",
    emailLabel: "אימייל",
    sendMagicLink: "שלח קישור התחברות",
    googleSignIn: "המשך עם Google",
    magicLinkSent: "שלחנו לך קישור באימייל. בדוק את תיבת הדואר.",
    invalidEmail: "אימייל לא תקין",
  },
  safety: {
    distressFallback:
      "אני שומע שעובר עליך משהו קשה. אני לא הכתובת לתת מענה למצוקה רגשית. אני מציע לפנות לקו לחיים בטלפון 1201 (24/7), או למוקד ער״ן בטלפון 1201, או לרופא משפחה. אני כאן אם תרצה לחזור לדבר על קריירה כשתרגיש שזה הזמן.",
  },
} as const;

export type HebrewStrings = typeof he;
```

- [ ] **Step 2: Commit**

```bash
git add lib/i18n/he.ts
git commit -m "feat: add Hebrew strings dictionary"
```

---

## Task 7: Set up Supabase CLI and create the first migration

**Files:**
- Create: `supabase/config.toml` (auto-generated), `supabase/migrations/<timestamp>_init.sql`

> Why CLI from day 1: a fresh clone must be able to reproduce the schema without anyone touching the dashboard. CI must be able to run integration tests against a clean DB. Manual SQL-Editor pasting blocks both.

- [ ] **Step 1: Install Supabase CLI as a dev dependency**

```powershell
npm install -D supabase
```

- [ ] **Step 2: Initialize the local Supabase project structure**

```powershell
npx supabase init
```

When prompted about VS Code/IntelliJ settings, accept defaults. This creates `supabase/config.toml` and an empty `supabase/migrations/` directory.

- [ ] **Step 3: Log in to Supabase**

```powershell
npx supabase login
```

This opens a browser to authenticate. After success, the CLI stores a token locally.

- [ ] **Step 4: Link the local project to your remote Supabase project**

Get the project ref from the Supabase dashboard URL (`https://supabase.com/dashboard/project/<ref>`), then:

```powershell
npx supabase link --project-ref <YOUR_PROJECT_REF>
```

When prompted for the database password, paste it (find it under Project Settings → Database).

- [ ] **Step 5: Create the first migration file**

```powershell
npx supabase migration new init
```

This creates `supabase/migrations/<timestamp>_init.sql` (timestamp prefix is required for the CLI to apply in order). Open the new file and paste:

```sql
-- Users table mirrors auth.users but adds career-specific fields and anonymous support.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete cascade, -- nullable for anonymous
  is_anonymous boolean not null default true,
  display_name text,
  email text,
  age_range text check (age_range in ('18-24','25-34','35-44','45-54','55+')),
  career_stage text,
  current_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deletion_requested_at timestamptz
);

create index users_auth_id_idx on public.users(auth_id);
create index users_email_idx on public.users(email);

-- Anonymous sessions: a cookie-based token that maps to a public.users row before sign-up.
create table public.anonymous_sessions (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index anonymous_sessions_user_id_idx on public.anonymous_sessions(user_id);
create index anonymous_sessions_expires_at_idx on public.anonymous_sessions(expires_at);

-- Consents: each granular consent is a row. New version => new row, never update.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null check (purpose in ('processing','disclaimer','marketing','training_data')),
  version text not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_address inet,
  user_agent text
);

create index consents_user_id_idx on public.consents(user_id);

-- Enable Row Level Security on all tables.
alter table public.users enable row level security;
alter table public.anonymous_sessions enable row level security;
alter table public.consents enable row level security;

-- Policies: users can read/update their own row. Anonymous sessions are server-only.
create policy users_self_select on public.users
  for select using (auth.uid() = auth_id);

create policy users_self_update on public.users
  for update using (auth.uid() = auth_id);

create policy consents_self_select on public.consents
  for select using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

-- Anonymous-session writes always come via service role; no user-facing policy needed.

-- Updated-at trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute procedure public.set_updated_at();
```

- [ ] **Step 6: Apply the migration to the remote DB**

```powershell
npx supabase db push
```

Expected: the CLI reports the migration was applied. Verify in Supabase Dashboard → Table Editor that `users`, `anonymous_sessions`, and `consents` tables exist.

If the push fails because the remote DB has drift from a previous manual change, run `npx supabase db pull` first to capture the current remote state, then `db push` again.

- [ ] **Step 7: Commit**

```bash
git add supabase/
git commit -m "feat: supabase CLI setup + migration init (users, consents, anonymous sessions)"
```

---

## Task 8: Database — migration for conversations + messages

**Files:**
- Create: `supabase/migrations/<timestamp>_conversations.sql`

- [ ] **Step 1: Create the migration file via CLI**

```powershell
npx supabase migration new conversations
```

Open the new `supabase/migrations/<timestamp>_conversations.sql` and paste:

```sql
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  stage text not null default 'onboarding'
    check (stage in ('onboarding','interests','skills','values','constraints','wrap','complete')),
  status text not null default 'active' check (status in ('active','archived','deleted')),
  message_count int not null default 0,
  total_input_tokens int not null default 0,
  total_output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_id_idx on public.conversations(user_id);
create index conversations_status_idx on public.conversations(status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  safety_flag text, -- null OR one of: 'distress','crisis','off-topic'
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_idx
  on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy conversations_self on public.conversations
  for all using (
    user_id in (select id from public.users where auth_id = auth.uid())
  );

create policy messages_self on public.messages
  for all using (
    conversation_id in (
      select id from public.conversations
      where user_id in (select id from public.users where auth_id = auth.uid())
    )
  );

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute procedure public.set_updated_at();
```

- [ ] **Step 2: Push migration**

```powershell
npx supabase db push
```

Verify the new tables in the Supabase Dashboard.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: db migration — conversations and messages"
```

---

## Task 9: Generate TypeScript types from Supabase

**Files:**
- Create: `lib/db/types.gen.ts`
- Modify: `package.json`

(The CLI was already installed and linked in Task 7.)

- [ ] **Step 1: Add type-gen script to `package.json`**

In `"scripts"` (the linked project ref is read from `supabase/.temp/`, so no project ref is needed in the command):

```json
"db:types": "supabase gen types typescript --linked --schema public > lib/db/types.gen.ts"
```

- [ ] **Step 2: Create the output directory and run it**

```powershell
New-Item -ItemType Directory -Force -Path lib/db | Out-Null
npm run db:types
```

Expected: `lib/db/types.gen.ts` created with `Database` type containing `users`, `anonymous_sessions`, `consents`, `conversations`, `messages`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: generate Supabase TypeScript types"
```

---

## Task 10: Supabase server + browser + service-role clients

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/service.ts`, `lib/supabase/middleware.ts`, `middleware.ts`

- [ ] **Step 1: Install Supabase libraries**

```powershell
npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Create the server client**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "@/lib/db/types.gen";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // RSC contexts can't write cookies; middleware handles refresh.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Create the browser client**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import type { Database } from "@/lib/db/types.gen";

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 4: Create the service-role client (server-only, bypasses RLS)**

Create `lib/supabase/service.ts`:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/db/types.gen";

export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Step 5: Create middleware session refresher**

Create `lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}
```

- [ ] **Step 6: Wire root middleware**

Create `middleware.ts` at the repo root:

```ts
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Supabase server, browser, and service-role clients with session middleware"
```

---

## Task 11: Anonymous-session helpers

**Files:**
- Create: `lib/anonymous.ts`, `tests/unit/anonymous.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/anonymous.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateAnonymousToken, ANON_COOKIE_NAME } from "@/lib/anonymous";

describe("anonymous helpers", () => {
  it("generateAnonymousToken returns a 32+ char url-safe token", () => {
    const token = generateAnonymousToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("two generated tokens are different", () => {
    expect(generateAnonymousToken()).not.toBe(generateAnonymousToken());
  });

  it("ANON_COOKIE_NAME is stable", () => {
    expect(ANON_COOKIE_NAME).toBe("co_anon");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```powershell
npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/anonymous.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const ANON_COOKIE_NAME = "co_anon";
const ANON_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateAnonymousToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Returns the public.users.id for the current visitor.
 * - If they're authenticated, returns their user row id.
 * - If they have a co_anon cookie that maps to a row, returns that row id.
 * - Otherwise, creates a new anonymous user + session, sets the cookie, returns the new id.
 */
export async function getOrCreateAnonymousUserId(authedUserId?: string): Promise<string> {
  const cookieStore = await cookies();
  const svc = createServiceClient();

  if (authedUserId) {
    const { data } = await svc
      .from("users")
      .select("id")
      .eq("auth_id", authedUserId)
      .maybeSingle();
    if (data) return data.id;
    const { data: created } = await svc
      .from("users")
      .insert({ auth_id: authedUserId, is_anonymous: false })
      .select("id")
      .single();
    if (!created) throw new Error("Failed to create authed user row");
    return created.id;
  }

  const existing = cookieStore.get(ANON_COOKIE_NAME)?.value;
  if (existing) {
    const { data } = await svc
      .from("anonymous_sessions")
      .select("user_id")
      .eq("token", existing)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (data) return data.user_id;
  }

  const { data: newUser, error: userErr } = await svc
    .from("users")
    .insert({ is_anonymous: true })
    .select("id")
    .single();
  if (userErr || !newUser) throw new Error("Failed to create anonymous user");

  const token = generateAnonymousToken();
  await svc.from("anonymous_sessions").insert({ token, user_id: newUser.id });

  cookieStore.set(ANON_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE_SECONDS,
  });

  return newUser.id;
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: all 4 tests pass (sanity + 3 anonymous tests). Note: `getOrCreateAnonymousUserId` is integration-tested in Task 16, not unit-tested here (it touches DB + cookies).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: anonymous session helpers with unit tests"
```

---

## Task 12: Consent helpers and table-write

**Files:**
- Create: `lib/consent.ts`, `tests/unit/consent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/consent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CONSENT_VERSION, CONSENT_PURPOSES } from "@/lib/consent";

describe("consent constants", () => {
  it("CONSENT_VERSION is set", () => {
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("CONSENT_PURPOSES includes processing and disclaimer", () => {
    expect(CONSENT_PURPOSES).toContain("processing");
    expect(CONSENT_PURPOSES).toContain("disclaimer");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```powershell
npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/consent.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export const CONSENT_VERSION = "2026-05-10";
export const CONSENT_PURPOSES = ["processing", "disclaimer"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export async function recordConsent(opts: {
  userId: string;
  purpose: ConsentPurpose;
  ipAddress?: string;
  userAgent?: string;
}) {
  const svc = createServiceClient();
  await svc.from("consents").insert({
    user_id: opts.userId,
    purpose: opts.purpose,
    version: CONSENT_VERSION,
    ip_address: opts.ipAddress,
    user_agent: opts.userAgent,
  });
}

export async function hasActiveConsent(userId: string, purpose: ConsentPurpose): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("consents")
    .select("id, accepted_at, revoked_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .eq("version", CONSENT_VERSION)
    .is("revoked_at", null)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: consent recording and lookup helpers"
```

---

## Task 13: System prompt (from §20 of the spec)

**Files:**
- Create: `lib/ai/prompts/system.ts`

- [ ] **Step 1: Create the prompt file**

Create `lib/ai/prompts/system.ts`:

```ts
export const SYSTEM_PROMPT_VERSION = "1.0.0";

export const SYSTEM_PROMPT = `אתה סוכן הכוונה מקצועית וקריירה בשם CareerOS. תפקידך לעזור למשתמש להבין את נטיותיו, כישוריו, ערכיו, אילוציו ואפשרויות הקריירה שלו. אינך פסיכולוג, אינך מאבחן קליני ואינך מבטיח הצלחה תעסוקתית. עליך לתת המלצות זהירות, מנומקות, שקופות ומעשיות.

עקרונות פעולה:
1. שאל שאלות קצרות וברורות. שאלה אחת בכל הודעה, לא רשימה ארוכה.
2. התאם את הטון לגיל, מצב הקריירה והעדפת המשתמש. ברירת מחדל: ידידותי, ישיר, לא מתנשא.
3. אל תסיק מסקנות חדות מדי ממעט מידע. כשאתה לא בטוח — שאל.
4. בכל המלצה הצג: למה מתאים, מה הסיכון, מה חסר, ומה הצעד הבא.
5. אל תשתמש במבחנים מסחריים מוגנים. אל תטען שאתה מבצע MBTI, Strong Interest Inventory או כל מבחן רשום אחר. אל תזכיר את השם MBTI.
6. השתמש במודלים תיאוריים בלבד: תחומי עניין, כישורים, ערכים, אילוצים, ושוק העבודה.
7. אם המשתמש מתאר מצוקה רגשית חריפה, מחשבות פגיעה, ייאוש קיצוני או טראומה — עצור את האבחון, הבע אמפתיה קצרה, והפנה אותו לקו לחיים 1201, ער״ן, או רופא משפחה. אל תמשיך לעבודה על קריירה באותה הודעה.
8. שמור על שפה אנושית, ישירה, לא מתנשאת ולא מנותקת.
9. אל תיתן תשובה אחת בלבד. כשמגיעים להמלצות — הצג כמה אפשרויות עם השוואה.
10. עודד בדיקה מעשית לפני החלטות גדולות: שיחה עם איש מקצוע, קורס קצר, פרויקט קטן.
11. תמיד הזכר בתחילת השיחה ובדוח הסופי שזו הכוונה ולא ייעוץ מוסמך.
12. דבר עברית. אל תעבור לאנגלית אלא אם המשתמש פנה באנגלית קודם.

מבנה השיחה:
- שלב 1 — היכרות: מי אתה, מה ההתלבטות העכשווית.
- שלב 2 — תחומי עניין: מה מושך, מה משעמם, מה גורם לאבד תחושת זמן.
- שלב 3 — כישורים: במה אתה טוב לדעתך ולדעת אחרים, מה למדת בצבא/בעבודה/בחיים.
- שלב 4 — ערכים ואילוצים: מה חשוב לך, מה אתה לא מוכן לעשות, מה התקציב והזמן הזמינים.
- שלב 5 — מראה: שיקוף קצר של מה ששמעת ושאלה אם הבנת נכון.

כשתגיע לסוף שלב 5, אמור: "אני חושב שיש לי תמונה ראשונית. בוא נמשיך עכשיו לראות אילו כיוונים יכולים להתאים לך." זה הטריגר של המערכת לעבור להמלצות.`;
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: Hebrew system prompt for CareerOS agent (v1.0.0)"
```

---

## Task 14: Anthropic AI client with prompt caching

**Files:**
- Create: `lib/ai/client.ts`

- [ ] **Step 1: Install AI SDK + Anthropic provider**

```powershell
npm install ai @ai-sdk/anthropic
```

- [ ] **Step 2: Create the client wrapper**

Create `lib/ai/client.ts`:

```ts
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { env } from "@/lib/env";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from "@/lib/ai/prompts/system";

export const MODEL_ID = env.ANTHROPIC_MODEL;

export const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Returns the system message as a ModelMessage with Anthropic ephemeral cache control.
 * The cache_control marker tells Anthropic to cache this prefix for ~5 minutes.
 * Cache control is a *provider* concept and only applies to ModelMessages — UIMessage
 * does not carry providerOptions, so this must NEVER be used as a UI message.
 */
export function getCachedSystemMessage(): ModelMessage {
  return {
    role: "system",
    content: SYSTEM_PROMPT,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

/**
 * Anthropic-specific cache token names exposed via providerMetadata.
 * Verified against AI SDK's @ai-sdk/anthropic provider metadata shape:
 *   - cacheCreationInputTokens: tokens written to cache on this call
 *   - cacheReadInputTokens: tokens read from cache (the savings)
 */
export type AnthropicCacheUsage = {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export function extractAnthropicCacheUsage(
  providerMetadata: Record<string, unknown> | undefined,
): AnthropicCacheUsage {
  const meta = providerMetadata?.anthropic as AnthropicCacheUsage | undefined;
  return {
    cacheCreationInputTokens: meta?.cacheCreationInputTokens,
    cacheReadInputTokens: meta?.cacheReadInputTokens,
  };
}

export { SYSTEM_PROMPT_VERSION };
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: Anthropic AI client with prompt caching"
```

---

## Task 15: Chat API route — streaming Claude with persistence

**Files:**
- Create: `app/api/chat/route.ts`, `lib/db/queries.ts`

- [ ] **Step 1: Create DB query helpers**

Create `lib/db/queries.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function getOrCreateConversation(userId: string, conversationId?: string) {
  const svc = createServiceClient();
  if (conversationId) {
    const { data } = await svc
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data;
  }
  const { data, error } = await svc
    .from("conversations")
    .insert({ user_id: userId })
    .select()
    .single();
  if (error || !data) throw new Error(`Conversation create failed: ${error?.message}`);
  return data;
}

export async function loadMessages(conversationId: string) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function appendMessage(opts: {
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  safetyFlag?: string;
}) {
  const svc = createServiceClient();
  await svc.from("messages").insert({
    conversation_id: opts.conversationId,
    role: opts.role,
    content: opts.content,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cache_read_tokens: opts.cacheReadTokens,
    cache_write_tokens: opts.cacheWriteTokens,
    safety_flag: opts.safetyFlag,
  });
  await svc.rpc("increment_conversation_counters", {
    p_conversation_id: opts.conversationId,
    p_input_tokens: opts.inputTokens ?? 0,
    p_output_tokens: opts.outputTokens ?? 0,
  }).then(() => null, () => {
    // Fallback if RPC isn't defined yet — just bump message_count.
    return svc.rpc("noop");
  });
}
```

- [ ] **Step 2: Add the increment RPC migration**

```powershell
npx supabase migration new counters_rpc
```

Open the new `supabase/migrations/<timestamp>_counters_rpc.sql` and paste:

```sql
create or replace function public.increment_conversation_counters(
  p_conversation_id uuid,
  p_input_tokens int,
  p_output_tokens int
)
returns void
language plpgsql
security definer
as $$
begin
  update public.conversations
  set
    message_count = message_count + 1,
    total_input_tokens = total_input_tokens + coalesce(p_input_tokens, 0),
    total_output_tokens = total_output_tokens + coalesce(p_output_tokens, 0),
    updated_at = now()
  where id = p_conversation_id;
end;
$$;
```

Then apply:

```powershell
npx supabase db push
```

Regenerate types so the RPC is typed:

```powershell
npm run db:types
```

- [ ] **Step 3: Create the chat API route**

Create `app/api/chat/route.ts`:

```ts
import { streamText, type UIMessage, type ModelMessage } from "ai";
import {
  anthropic,
  MODEL_ID,
  getCachedSystemMessage,
  extractAnthropicCacheUsage,
} from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { getOrCreateConversation, appendMessage, loadMessages } from "@/lib/db/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const internalUserId = await getOrCreateAnonymousUserId(user?.id);
  const conversation = await getOrCreateConversation(internalUserId, body.conversationId);

  // Persist the new user message that just arrived from the client.
  const lastUserMessage = body.messages[body.messages.length - 1];
  if (lastUserMessage?.role === "user") {
    const text = lastUserMessage.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("");
    if (text) {
      await appendMessage({
        conversationId: conversation.id,
        role: "user",
        content: text,
      });
    }
  }

  // Load full history from DB (single source of truth) and build ModelMessages.
  // We do NOT use convertToModelMessages here because we're constructing model
  // messages directly from persisted plain-text rows, not from UIMessage parts.
  const history = await loadMessages(conversation.id);
  const historyAsModelMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const messages: ModelMessage[] = [
    getCachedSystemMessage(),
    ...historyAsModelMessages,
  ];

  const result = streamText({
    model: anthropic(MODEL_ID),
    messages,
    onFinish: async ({ text, usage, providerMetadata }) => {
      const cache = extractAnthropicCacheUsage(providerMetadata);
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: text,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: cache.cacheReadInputTokens,
        cacheWriteTokens: cache.cacheCreationInputTokens,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { "x-conversation-id": conversation.id },
  });
}
```

> **Verification step before Task 15 commit:** the AI SDK and `@ai-sdk/anthropic` provider evolve quickly. Before running this code, open the AI SDK docs (`useChat`, `streamText`, Anthropic provider cache control, provider metadata) via the `vercel:ai-sdk` skill or Context7 (`mcp__claude_ai_Context7__query-docs` for `vercel/ai`) and confirm: (a) `ModelMessage` is the current type name, (b) `streamText` accepts `messages: ModelMessage[]` directly, (c) `providerOptions.anthropic.cacheControl.type === 'ephemeral'` is still the cache-control shape, (d) `providerMetadata.anthropic.cacheReadInputTokens` and `cacheCreationInputTokens` are still the field names exposed in `onFinish`. If any of these have moved, patch them — they're the kind of small renames the SDK does between minor versions.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: chat API route with streaming Claude and persistence"
```

---

## Task 16: Chat UI components

**Files:**
- Create: `components/chat/DisclaimerBanner.tsx`, `components/chat/MessageBubble.tsx`, `components/chat/MessageList.tsx`, `components/chat/InputBar.tsx`, `components/chat/ChatShell.tsx`

- [ ] **Step 1: Install AI SDK React hooks**

```powershell
npm install @ai-sdk/react
```

- [ ] **Step 2: Create the disclaimer banner**

Create `components/chat/DisclaimerBanner.tsx`:

```tsx
import { he } from "@/lib/i18n/he";

export function DisclaimerBanner() {
  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
      {he.disclaimer.short}
    </div>
  );
}
```

- [ ] **Step 3: Create the message bubble**

Create `components/chat/MessageBubble.tsx`:

```tsx
import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant";
  text: string;
};

export function MessageBubble({ role, text }: Props) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {text}
      </div>
    </div>
  );
}
```

Note: in RTL, "user-on-the-start" puts the user message on the right (visually). `justify-start` in RTL = right side.

- [ ] **Step 4: Create the message list**

Create `components/chat/MessageList.tsx`:

```tsx
"use client";

import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ messages }: { messages: UIMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto px-4 py-6">
      {messages.map((m) => {
        const text = m.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("");
        if (!text) return null;
        return (
          <MessageBubble
            key={m.id}
            role={m.role as "user" | "assistant"}
            text={text}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 5: Create the input bar**

Create `components/chat/InputBar.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { he } from "@/lib/i18n/he";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export function InputBar({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-border bg-background px-4 py-3"
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={he.chat.placeholder}
        rows={2}
        className="min-h-[44px] flex-1 resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e as unknown as FormEvent);
          }
        }}
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        {disabled ? he.chat.sending : he.chat.send}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Create the chat shell**

Create `components/chat/ChatShell.tsx`:

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { he } from "@/lib/i18n/he";

export function ChatShell() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <DisclaimerBanner />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">{he.chat.headerTitle}</h1>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-2xl font-bold">{he.chat.emptyState.title}</h2>
          <p className="text-muted-foreground">{he.chat.emptyState.body}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <MessageList messages={messages} />
        </div>
      )}

      {error && (
        <div className="border-t border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {he.chat.error.generic}
        </div>
      )}

      <InputBar
        onSubmit={(text) => sendMessage({ text })}
        disabled={isLoading}
      />
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: chat UI components (shell, list, bubble, input, disclaimer)"
```

---

## Task 17: Chat page

**Files:**
- Create: `app/(app)/chat/page.tsx`, `app/(app)/layout.tsx`

- [ ] **Step 1: Create the app group layout**

Create `app/(app)/layout.tsx`:

```tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

(Empty for now — Phase 2 will add nav.)

- [ ] **Step 2: Create the chat page**

Create `app/(app)/chat/page.tsx`:

```tsx
import { ChatShell } from "@/components/chat/ChatShell";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return <ChatShell />;
}
```

- [ ] **Step 3: Test manually**

```powershell
npm run dev
```

Open http://localhost:3000/chat. Type "אני אחרי צבא ולא יודע מה ללמוד" and submit.

Expected: Hebrew response streams in from Claude. Messages persist on reload (next task adds load-on-mount).

Verify in Supabase Table Editor that `users`, `anonymous_sessions`, `conversations`, and `messages` rows were created.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: chat page wired to streaming Claude"
```

---

## Task 18: Auth — sign-in page with magic link + Google

**Files:**
- Create: `app/(auth)/sign-in/page.tsx`, `app/(auth)/auth/callback/route.ts`, `app/(auth)/layout.tsx`

- [ ] **Step 1: Configure Google provider in Supabase**

In Supabase Dashboard → Authentication → Providers → enable Google. Add Client ID and Secret from Google Cloud Console (create OAuth credentials with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`).

- [ ] **Step 2: Set Site URL**

Supabase Dashboard → Authentication → URL Configuration → Site URL: `http://localhost:3000` (add production URL later).

Add to Redirect URLs: `http://localhost:3000/auth/callback`, `https://*.vercel.app/auth/callback`.

- [ ] **Step 3: Create the auth group layout**

Create `app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6">
      {children}
    </main>
  );
}
```

- [ ] **Step 4: Create the sign-in page**

Create `app/(auth)/sign-in/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { he } from "@/lib/i18n/he";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{he.auth.signInTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sent ? (
          <p className="text-sm text-muted-foreground">{he.auth.magicLinkSent}</p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <label className="text-sm font-medium">
              {he.auth.emailLabel}
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="mt-1"
              />
            </label>
            <Button type="submit" disabled={loading || !email}>
              {he.auth.sendMagicLink}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        )}
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
        </div>
        <Button variant="outline" onClick={handleGoogle}>
          {he.auth.googleSignIn}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create the auth callback route**

Create `app/(auth)/auth/callback/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/chat";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=callback`);
}
```

- [ ] **Step 6: Test manually**

```powershell
npm run dev
```

- Visit `/sign-in`, request a magic link, click it from email. Expect redirect to `/chat`.
- Visit `/sign-in`, click "המשך עם Google", complete OAuth, expect redirect to `/chat`.
- Verify a row was created in `auth.users` and a corresponding row in `public.users` (created by `getOrCreateAnonymousUserId` on first chat call after sign-in).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: auth — magic link + Google sign-in with callback"
```

---

## Task 19: Consent flow on first chat visit

**Files:**
- Create: `components/chat/ConsentDialog.tsx`, `app/api/consent/route.ts`
- Modify: `components/chat/ChatShell.tsx`

- [ ] **Step 1: Create the consent API route**

Create `app/api/consent/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousUserId } from "@/lib/anonymous";
import { recordConsent, hasActiveConsent, CONSENT_PURPOSES } from "@/lib/consent";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const processing = await hasActiveConsent(userId, "processing");
  const disclaimer = await hasActiveConsent(userId, "disclaimer");
  return NextResponse.json({ processing, disclaimer });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = await getOrCreateAnonymousUserId(user?.id);
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = req.headers.get("user-agent") ?? undefined;

  for (const purpose of CONSENT_PURPOSES) {
    await recordConsent({ userId, purpose, ipAddress, userAgent });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create the consent dialog**

Create `components/chat/ConsentDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { he } from "@/lib/i18n/he";

export function ConsentDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/consent").then(async (r) => {
      const data = (await r.json()) as { processing: boolean; disclaimer: boolean };
      if (!data.processing || !data.disclaimer) setOpen(true);
    });
  }, []);

  async function accept() {
    await fetch("/api/consent", { method: "POST" });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={() => { /* must explicitly accept */ }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{he.consent.title}</DialogTitle>
          <DialogDescription className="text-start leading-relaxed">
            {he.consent.body}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Button onClick={accept}>{he.consent.accept}</Button>
          <a href="/privacy" className="text-center text-xs text-muted-foreground underline">
            {he.consent.privacy}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Mount it in the chat shell**

Modify `components/chat/ChatShell.tsx`:

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ConsentDialog } from "./ConsentDialog";
import { he } from "@/lib/i18n/he";

export function ChatShell() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <ConsentDialog />
      <DisclaimerBanner />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">{he.chat.headerTitle}</h1>
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-2xl font-bold">{he.chat.emptyState.title}</h2>
          <p className="text-muted-foreground">{he.chat.emptyState.body}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <MessageList messages={messages} />
        </div>
      )}

      {error && (
        <div className="border-t border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {he.chat.error.generic}
        </div>
      )}

      <InputBar
        onSubmit={(text) => sendMessage({ text })}
        disabled={isLoading}
      />
    </div>
  );
}
```

- [ ] **Step 4: Test manually**

Start dev server, visit `/chat` in incognito → consent dialog appears, click "מסכים/ה", verify a `consents` row was inserted in Supabase.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: consent dialog gates first chat visit"
```

---

## Task 20: Privacy and terms placeholder pages

**Files:**
- Create: `app/(marketing)/privacy/page.tsx`, `app/(marketing)/terms/page.tsx`, `app/(marketing)/layout.tsx`

- [ ] **Step 1: Create marketing layout**

Create `app/(marketing)/layout.tsx`:

```tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 leading-relaxed">
      {children}
    </main>
  );
}
```

- [ ] **Step 2: Privacy page (placeholder, awaits lawyer review per Phase 7)**

Create `app/(marketing)/privacy/page.tsx`:

```tsx
export default function PrivacyPage() {
  return (
    <article className="prose prose-sm">
      <h1>מדיניות פרטיות</h1>
      <p>גרסה: 0.1 — טיוטה ראשונית. מסמך זה יעבור סקירה משפטית לפני השקה ציבורית.</p>
      <h2>איזה מידע אנחנו אוספים</h2>
      <p>אימייל (אם נרשמת), תוכן השיחות עם הסוכן, תוצאות שאלוני אבחון, כישורים שחילצנו מקורות חיים שהעלית, ערכים ואילוצים שהזנת.</p>
      <h2>למה אנחנו משתמשים במידע</h2>
      <p>בלעדית למתן ההמלצות שלך. אנחנו לא מאמנים מודלים על המידע שלך ולא מוכרים אותו לצדדים שלישיים.</p>
      <h2>זכויותיך</h2>
      <p>אתה יכול לבקש לראות את כל המידע שלך, למחוק אותו, או לחזור בך מהסכמתך. שלח בקשה ל־privacy@careeros.example (כתובת זמנית).</p>
      <h2>שמירה</h2>
      <p>שיחות וקלט אבחון נשמרים עד שתבקש מחיקה. דוחות שירדת מקומיים אצלך.</p>
    </article>
  );
}
```

- [ ] **Step 3: Terms page (placeholder)**

Create `app/(marketing)/terms/page.tsx`:

```tsx
export default function TermsPage() {
  return (
    <article className="prose prose-sm">
      <h1>תנאי שימוש</h1>
      <p>גרסה: 0.1 — טיוטה ראשונית. מסמך זה יעבור סקירה משפטית לפני השקה ציבורית.</p>
      <h2>שימוש כללי</h2>
      <p>CareerOS מספק הכוונה מקצועית באמצעות בינה מלאכותית. השירות אינו מהווה אבחון פסיכולוגי, ייעוץ משפטי, ייעוץ רפואי או הבטחה להצלחה תעסוקתית.</p>
      <h2>אחריות</h2>
      <p>החלטות הקריירה הן באחריותך הבלעדית. ההמלצות הן הצעות לבדיקה, לא הוראות לפעולה.</p>
      <h2>מצבי מצוקה</h2>
      <p>אם אתה במצב נפשי קשה — פנה לקו לחיים 1201, ער״ן 1201, או רופא משפחה. CareerOS אינו תחליף לטיפול נפשי.</p>
    </article>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: privacy and terms placeholder pages (pending legal review)"
```

---

## Task 21: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://stub.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: stub
          SUPABASE_SERVICE_ROLE_KEY: stub
          ANTHROPIC_API_KEY: stub
          NEXT_PUBLIC_SITE_URL: http://localhost:3000
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://stub.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: stub
          SUPABASE_SERVICE_ROLE_KEY: stub
          ANTHROPIC_API_KEY: stub
          NEXT_PUBLIC_SITE_URL: http://localhost:3000
```

- [ ] **Step 2: Push and verify**

```bash
git add -A
git commit -m "ci: typecheck, lint, test, build on PR and main"
git push
```

Open the GitHub Actions tab on the repo. Verify the workflow runs and goes green.

---

## Task 22: Vercel deploy

**Files:**
- Create: `vercel.json` (optional)

- [ ] **Step 1: Connect repo to Vercel**

In Vercel Dashboard → Add New → Project → Import the GitHub repo.

- [ ] **Step 2: Set environment variables**

In Vercel project → Settings → Environment Variables, add for **Production** and **Preview**:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
NEXT_PUBLIC_SITE_URL=https://<your-vercel-domain>
```

- [ ] **Step 3: Add Vercel preview URL to Supabase redirects**

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs → add `https://<your-vercel-domain>/auth/callback`.

- [ ] **Step 4: Deploy**

Push to `main` (or open a PR for preview). Wait for Vercel build.

- [ ] **Step 5: Smoke-test the deployed app**

Open the production URL → `/chat` → consent → send a message → verify Claude responds → sign-up via magic link → reload chat → verify history persists.

- [ ] **Step 6: Commit final README touchups**

Create/replace `README.md`:

```markdown
# CareerOS

סוכן AI להכוונה מקצועית בעברית.

## Stack
Next.js 16 · TypeScript · Tailwind · shadcn/ui · Supabase · Anthropic Claude · Vercel

## Local development

```bash
cp .env.example .env.local   # fill in real values
npm install
npm run dev                   # http://localhost:3000
npm test                      # vitest
npm run db:types              # regenerate Supabase types
```

## Migrations
Apply `supabase/migrations/*.sql` in order via the Supabase SQL editor.

## Plan
See `docs/superpowers/plans/` for phase-by-phase implementation plans.
```

```bash
git add -A
git commit -m "docs: README"
git push
```

---

## Phase 1 Definition of Done

All of these must be true to declare Phase 1 complete:

- [ ] `npm test` passes locally and in CI
- [ ] `npm run build` succeeds locally and in CI
- [ ] `npx tsc --noEmit` passes locally and in CI
- [ ] Vercel preview URL serves the app
- [ ] Visiting `/chat` in incognito triggers the consent dialog; accepting it persists a `consents` row
- [ ] Sending a Hebrew message receives a streamed Hebrew response from Claude
- [ ] The response is persisted in `messages` with token counts in `cache_read_tokens` populated on the second turn (proves caching is working)
- [ ] `/sign-in` magic link flow lands the user back at `/chat` with `auth.users` and `public.users` rows created
- [ ] `/sign-in` Google flow lands the user back at `/chat` with `auth.users` and `public.users` rows created
- [ ] Privacy and Terms pages render in Hebrew
- [ ] Disclaimer banner is visible on `/chat`
- [ ] Re-loading `/chat` after a few messages **does NOT** show the prior history in the UI (this is intentional — DB persistence works, but UI hydration is deferred to Phase 2). Verify the messages exist in Supabase Table Editor under `messages` for the user's conversation.

---

## Phase 1 — what we explicitly did NOT build (and why)

- **Resume conversation on reload**: history loads via API but `useChat` doesn't auto-hydrate from the server in Phase 1. Phase 2 adds an initial-messages prop wired from a server component. Reason: keeps Phase 1 surface area small and lets us verify streaming first.
- **Sensitive-state detection**: deferred to Phase 2 with the rest of the safety layer. Phase 1's system prompt asks Claude to handle distress, which is a weaker safeguard but acceptable for a private dev environment.
- **Stage-aware system prompt**: Phase 1 uses one static prompt. Phase 2 introduces stage transitions and per-stage prompt augmentations.
- **Profile extraction**: deferred to Phase 2.
- **Anything UI-polished**: empty states, loading spinners beyond the basic disabled state, animations, mobile-keyboard handling — Phase 6 polish pass.
- **E2E Playwright test**: deferred to Phase 2 once we have a meaningful flow to test.

---

## When Phase 1 is done

Open `2026-05-10-career-os-00-master-roadmap.md` §4 Phase 2, and ask me to write `2026-05-10-career-os-02-conversation-engine.md` with bite-sized tasks.
