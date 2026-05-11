# CareerOS — Phase 3b: CV Upload + Skill Extraction ("המראה")

**Goal:** Turn a CV upload into a reflective, interactive moment where the user sees their own skills articulated back to them in Hebrew. Output is a confirmed skill set written to `career_profile.data.skills`, which immediately sharpens Phase 4 matching (no more fuzzy substring matching of free-form chat skills).

**Architecture:** PDF/DOCX text extraction via pure-Node libraries (`pdf-parse`, `mammoth`). Skill extraction via Anthropic LLM with `streamObject` (AI SDK v6) — the LLM emits a 2-3 sentence Hebrew **reflection** plus a streaming list of **skill cards** with `id` / `confidence` / `evidence`. The streaming pattern is the killer UX: the user watches the AI "read" their CV in real time. Confirmed skills land in `career_profile.data.skills` via a second `/api/cv/confirm` call. Same anonymous-friendly RLS pattern as Phase 3a (service-role queries in `lib/db/cv.ts`).

**Why "The Mirror":** A CV is emotional, not just data. Israeli post-army users often feel their CV is thin. The flow's job is to *read them back to themselves better than they would* — show strengths they didn't articulate. Every UI choice serves that.

---

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| File formats | **PDF + DOCX, ≤10MB** | Master roadmap §3. TXT and others rejected client-side. 10MB is generous for any real CV. |
| Parser libs | **`pdf-parse` (PDF) + `mammoth` (DOCX)** | Pure Node, no native deps, work on Vercel Functions. Both well-maintained. |
| Storage | **Supabase Storage bucket `cv-uploads`**, path `<user_id>/<uuid>.{pdf,docx}` | Standard pattern. RLS via storage policy: `owner = auth.uid()`. Service-role exempt for anon flow. |
| Storage retention | **30 days, then auto-delete** | Lifecycle rule on the bucket. Allows re-extract within a month. CV is sensitive PII — don't keep longer. |
| Extraction | **LLM with `streamObject` (AI SDK v6)** | Streams partial JSON. The reflection text streams character-by-character; skill cards bloom in one by one. Perceived speed transforms a 10-15s wait into a delightful moment. |
| Prompt cache | **System prompt cached** (same pattern as Phase 4 explanations) | The taxonomy (~60 skills × ~80 tokens each ≈ 5K tokens) is the bulk of the system prompt — caching is mandatory, not optional. |
| Skills outside taxonomy | **Emitted as `other_skills` (free-form Hebrew)** | Don't silently drop user data. User can promote them inline via taxonomy-autocomplete. |
| Confidence handling | **Show all skills ≥0.5, user confirms each by tap** | LLM is fuzzy in Hebrew — confirm step is the safety net. Skills <0.5 not shown. |
| Chat-vs-CV skill merge | **CV skills replace chat-extracted skills** | CV is more authoritative. Chat skills move to `data.skills_from_chat` for audit on **first CV confirm only**. Subsequent re-uploads just replace `data.skills` with the new confirmed set; old CV skills are not archived (the latest CV is always the source of truth). |
| Skill record shape | **Store both `id` and `name_he`** in each profile skill entry | Lets Phase 4's substring-based scorer continue working unchanged (it reads `name_he`). Future Phase 4.5 can switch to precise id-based matching without re-engineering 3b. Shape: `{id: 'python', name_he: 'Python', source: 'cv', evidence?: '...'}`. |
| Privacy/consent | **Explicit consent checkbox on `/cv` page**, required to enable upload | CV is sensitive PII. Lawyer-friendly. |
| UI flow | **Sync streaming** (no polling) | Vercel Functions default 300s timeout; extraction is 5-15s. Stream is more interactive than poll. |
| Evidence display | **Inline expandable per skill card** (not split-pane) | Split-pane is mobile-hostile and cluttered. Tap-to-expand is gesturally natural and works at any width. |
| Category meter | **Live horizontal stacked bar above sticky CTA** | Real-time profile-shape feedback as user toggles skills. Updates from confirmed set. |
| Archetype on success | **Computed deterministically from dominant category** | No extra LLM call. Mapping in `lib/cv/archetype.ts`. |
| Recompute recommendations | **Force-recompute on confirm** (`force=true` in POST body) | Adding skills changes profile hash; cached recommendation is stale. |

---

## 2. Architecture

### 2.1 Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│ /cv page                                                         │
│   1. User uploads file + checks consent                          │
│      └─> POST /api/cv/upload  (multipart, streaming response)    │
│           ├─> validate (size/type)                               │
│           ├─> upload to Supabase Storage                         │
│           ├─> parse (pdf-parse or mammoth)                       │
│           ├─> truncate to 50KB                                   │
│           ├─> streamObject {                                     │
│           │     reflection_he: string,    // streamed first     │
│           │     skills: [{id, conf, evidence}],                 │
│           │     other_skills: [phrase]                          │
│           │   }                                                  │
│           └─> insert cv_uploads row (extracted_text + skills)   │
│   2. Client uses useObject() to render reflection + skill cards │
│   3. User taps cards (keep/dismiss/expand-evidence), adds       │
│      missing skills via autocomplete                             │
│   4. User clicks "שמור כישורים"                                  │
│      └─> POST /api/cv/confirm  {cv_upload_id, skill_ids[]}      │
│           ├─> update cv_uploads.confirmed_at                     │
│           ├─> write career_profile.data.skills (replace)         │
│           └─> archive prior chat skills to data.skills_from_chat │
│   5. Success state → "התראה לי איך זה משנה את ההמלצות"           │
│      └─> POST /api/recommendations {force: true}                 │
│      └─> router.push("/recommendations")                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 DB schema

One new table, one new bucket. No changes to existing tables.

```sql
CREATE TABLE cv_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  extracted_text TEXT,             -- first 50KB only
  reflection_he TEXT,              -- LLM reflection
  extracted_skills JSONB NOT NULL DEFAULT '{}'::jsonb,
                                   -- {taxonomy: [{id, confidence, evidence}],
                                   --  other: [phrase]}
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cv_uploads_user_id_idx ON cv_uploads (user_id, created_at DESC);

ALTER TABLE cv_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_uploads_select_own" ON cv_uploads
  FOR SELECT USING (
    user_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- Insert/update go through service role (matches assessments pattern)
```

Storage bucket `cv-uploads`:
- Public: **false**
- RLS: `owner = auth.uid()` (service-role exempt)
- Lifecycle: delete after 30 days

### 2.3 LLM schema (zod)

```ts
const CvExtractionSchema = z.object({
  reflection_he: z.string()
    .describe("2-3 sentences in Hebrew reflecting back what stands out in this CV. Warm but honest tone. Quote specific things from the CV."),
  skills: z.array(z.object({
    id: z.string().describe("taxonomy id from the provided list, or 'other:<short phrase>' if not in taxonomy"),
    confidence: z.number().min(0).max(1),
    evidence: z.string().describe("the exact phrase from the CV that supports this skill"),
  })).max(20),
  other_skills: z.array(z.string()).max(10)
    .describe("free-form Hebrew skill phrases that don't map to the taxonomy but seem worth surfacing"),
});
```

### 2.4 New files

```
app/
├── (app)/
│   └── cv/page.tsx                          # /cv route
├── api/
│   └── cv/
│       ├── upload/route.ts                  # multipart → stream extract
│       └── confirm/route.ts                 # write to career_profile

components/cv/
├── CvUploadClient.tsx                       # composes the 4 moments
├── CvDropZone.tsx                           # Moment 1: file picker + consent
├── CvReadingState.tsx                       # Moment 2: streaming reflection + cards
├── CvSkillCard.tsx                          # single card with expand-evidence
├── CvReview.tsx                             # Moment 3: toggles, manual add, meter
├── CvCategoryMeter.tsx                      # horizontal stacked bar
├── CvSkillAutocomplete.tsx                  # taxonomy-typeahead input
└── CvSuccess.tsx                            # Moment 4: archetype + CTA

lib/cv/
├── parse.ts                                 # pdf-parse + mammoth wrappers
├── extract.ts                               # streamObject LLM call
├── archetype.ts                             # category-distribution → archetype string
├── prompt.ts                                # system prompt with taxonomy
└── types.ts                                 # CvExtractionResult, CvSkill, etc.

lib/db/cv.ts                                 # service-role queries
supabase/migrations/2026XXXX_cv_uploads.sql  # table + bucket setup
tests/unit/cv/parse.test.ts                  # mocked file inputs
tests/unit/cv/archetype.test.ts              # category-distribution mapping
tests/integration/cv-confirm.test.ts         # confirm flow → career_profile
```

i18n additions in `lib/i18n/he.ts` under `he.cv.*`.

---

## 3. Tasks

### Task 1: Install dependencies

```bash
npm install pdf-parse mammoth
npm install --save-dev @types/pdf-parse
```

Verify both work on Node 20 Vercel runtime (they do — pure JS, no native).

### Task 2: DB migration — `cv_uploads` table

`supabase/migrations/2026XXXX_cv_uploads.sql`:
- Table per §2.2 above
- RLS policy for SELECT (owner via users.auth_id = auth.uid())
- INSERT/UPDATE handled by service-role from `lib/db/cv.ts`

After migration: `npm run db:types` to regenerate `lib/db/types.gen.ts`.

### Task 3: Supabase Storage bucket setup

Two options — pick one:
- (a) Migration runs `INSERT INTO storage.buckets(id, public) VALUES ('cv-uploads', false)` + policies via SQL
- (b) Create via Supabase Dashboard, document in CLAUDE.md

**Pick (a) for reproducibility on fresh clones.**

Storage RLS:
```sql
CREATE POLICY "cv_select_own" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'cv-uploads' AND
    (storage.foldername(name))[1]::uuid IN
      (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );
-- INSERT via service role only
```

Lifecycle rule (30-day delete) — configurable via dashboard if SQL not supported.

### Task 4: `lib/cv/parse.ts` — text extraction

```ts
import "server-only";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (mimeType === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error(`unsupported_mime: ${mimeType}`);
}

export function truncate(text: string, maxChars = 50_000): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
```

Tests: small fixture PDF + DOCX in `tests/fixtures/cv/` (synthetic, public-knowledge content — no real PII).

### Task 5: `lib/cv/prompt.ts` — system prompt with taxonomy

```ts
import { TAXONOMY } from "@/content/skills/taxonomy.json";  // already exists

export function buildSystemPrompt(): string {
  return `You are a CV skill extractor for an Israeli career-guidance app.
The user is Hebrew-speaking, post-army or pre-studies. Read the CV text carefully.

Output strict JSON matching this schema:
- reflection_he: 2-3 sentences in Hebrew. Warm but honest. Quote specific things from the CV. Address the reader as "אתה/את". This is the FIRST thing they see — make it feel like you read them, not their document.
- skills: up to 20 items. Each has:
  - id: a taxonomy id from the list below, OR "other:<short Hebrew phrase>" if no taxonomy match
  - confidence: 0-1, your confidence the person actually has this skill
  - evidence: the EXACT phrase from the CV (Hebrew or English) that shows this skill
- other_skills: up to 10 free-form Hebrew phrases that are skill-like but don't fit the taxonomy

Taxonomy (id → Hebrew name → category):
${TAXONOMY.skills.map(s => `- ${s.id} → ${s.name_he} (${s.category})`).join("\n")}

Rules:
- Don't invent skills. If the CV doesn't mention something, don't list it.
- Confidence reflects EVIDENCE strength, not skill quality. A clearly demonstrated skill = 0.9+.
- Reflection should mention 1-2 specific things from the CV (e.g., a project, a role).
- Hebrew first, but technical terms can stay in English.`;
}
```

### Task 6: `lib/cv/extract.ts` — streaming LLM call

```ts
import "server-only";
import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { buildSystemPrompt } from "./prompt";

export const CvExtractionSchema = z.object({ /* per §2.3 */ });

export function streamCvExtraction(cvText: string) {
  return streamObject({
    model: anthropic(process.env.ANTHROPIC_MODEL!),
    schema: CvExtractionSchema,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      { role: "user", content: cvText },
    ],
  });
}
```

### Task 7: `lib/cv/archetype.ts`

```ts
export type Archetype = "builder" | "connector" | "analyst" | "leader" | "creator" | "generalist";

export function inferArchetype(skillCategories: string[]): Archetype {
  const counts = new Map<string, number>();
  for (const c of skillCategories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const total = skillCategories.length;
  if (total === 0) return "generalist";
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (dominant[1] / total >= 0.5) {
    switch (dominant[0]) {
      case "technical": return "builder";
      case "social": return "connector";
      case "analytical": return "analyst";
      case "managerial": return "leader";
      case "creative": return "creator";
    }
  }
  return "generalist";
}
```

Mapped to Hebrew strings in `he.cv.archetypeNames`.

### Task 8: `lib/db/cv.ts` — service-role queries

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function createCvUpload(row: {...}): Promise<{id: string}> { /* INSERT */ }
export async function setExtraction(id: string, extracted_text: string, reflection_he: string, extracted_skills: object): Promise<void> { /* UPDATE */ }
export async function confirmCvUpload(id: string, userId: string): Promise<void> { /* UPDATE confirmed_at */ }
export async function getLatestCvForUser(userId: string): Promise<CvUpload | null> { /* SELECT */ }
```

Same service-role pattern as `lib/db/assessments.ts`.

### Task 9: `POST /api/cv/upload` — streaming route

```ts
export async function POST(request: Request) {
  const userId = await getOrCreateAnonymousUserId();
  const formData = await request.formData();
  const file = formData.get("file") as File;

  // Validate
  if (!file || file.size > 10 * 1024 * 1024) return Response.json({error: "file_too_large"}, {status: 400});
  if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type))
    return Response.json({error: "unsupported_type"}, {status: 400});

  // Upload to storage
  const storagePath = `${userId}/${crypto.randomUUID()}.${file.name.split(".").pop()}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const supa = createServiceClient();
  await supa.storage.from("cv-uploads").upload(storagePath, buf, { contentType: file.type });

  // Parse + extract
  const text = truncate(await extractText(buf, file.type));
  const upload = await createCvUpload({ user_id: userId, storage_path: storagePath, original_filename: file.name, mime_type: file.type, size_bytes: file.size });

  const result = streamCvExtraction(text);

  // After stream completes, persist to DB
  result.object.then(async (obj) => {
    await setExtraction(upload.id, text, obj.reflection_he, { taxonomy: obj.skills, other: obj.other_skills });
  });

  // Stream to client with the upload id in a header
  return result.toTextStreamResponse({ headers: { "X-Cv-Upload-Id": upload.id } });
}
```

### Task 10: `POST /api/cv/confirm` — write to profile

```ts
export async function POST(request: Request) {
  const userId = await getOrCreateAnonymousUserId();
  const { cv_upload_id, skill_ids } = await request.json();  // skill_ids includes taxonomy ids + "other:..." entries

  await confirmCvUpload(cv_upload_id, userId);

  // Merge into career_profile.data.skills (replace)
  // Archive prior data.skills to data.skills_from_chat
  // (uses existing merge_career_profile RPC or similar)

  return Response.json({ ok: true });
}
```

### Task 11: `/cv` page

`app/(app)/cv/page.tsx`:
```tsx
export default async function CvPage() {
  const userId = await getOrCreateAnonymousUserId();
  const existing = await getLatestCvForUser(userId);
  return <CvUploadClient existing={existing} />;
}
```

`components/cv/CvUploadClient.tsx`:
- Composes the 4 moments. State machine: `idle → uploading → reading → reviewing → confirming → success`.
- If `existing && existing.confirmed_at`: show success state with re-upload link.
- If `existing && !existing.confirmed_at`: resume at review state.
- Otherwise start at idle (drop zone).

### Task 12: Moment 1 — `CvDropZone`

`components/cv/CvDropZone.tsx`:
- Large drop zone, dashed border, animates on drag-over (transform scale + border color, ≤200ms).
- Click-to-browse fallback.
- File selected → show chip with filename + size + remove button.
- Consent checkbox below: *"אני מאשר/ת העלאת קורות החיים שלי לעיבוד"*.
- "התחל" button enabled only when file picked + consent checked.

### Task 13: Moment 2 — `CvReadingState`

`components/cv/CvReadingState.tsx`:
- Uses `useObject` from `@ai-sdk/react` against `/api/cv/upload`.
- Top: `<Typewriter text={partialObject?.reflection_he ?? ""} />` — animated character-by-character (we already have this style of streaming for chat).
- Below: skill grid. Each skill from `partialObject?.skills ?? []` renders as `<CvSkillCard>` with slide-up-fade-in entrance animation.
- Rotating status text (cosmetic, 2s intervals): *"מזהה כישורים טכניים..." / "מחפש ניסיון ניהולי..."*. Stops when stream completes.
- Live counter: *"זיהיתי {n} כישורים..."*.
- When stream completes, transitions to Moment 3.

### Task 14: `CvSkillCard` + Moment 3 — `CvReview`

`components/cv/CvSkillCard.tsx`:
- Confidence dot (green ≥0.8, amber 0.5-0.8, hide <0.5).
- Skill name (large, Heebo bold).
- Tap to expand → reveals evidence snippet from CV.
- Tap × to dismiss → slides to "לא רלוונטי" tray.

`components/cv/CvReview.tsx`:
- Renders the grid of confirmed skills + dismissed tray (collapsible).
- "Other skills" chip row — each chip is editable + addable.
- `<CvSkillAutocomplete>` input for manually adding skills (Hebrew typeahead over taxonomy).
- `<CvCategoryMeter>` above the sticky bottom bar.
- Sticky bottom bar: counter + "שמור" button + "ביטול".

### Task 15: `CvCategoryMeter` + `CvSkillAutocomplete` + `CvSuccess`

- `CvCategoryMeter.tsx`: horizontal stacked bar, colored by category, with mini-labels.
- `CvSkillAutocomplete.tsx`: input with dropdown of matching taxonomy skills (filter on `name_he`).
- `CvSuccess.tsx`: animated checkmark (SVG stroke-draw), archetype line, CTA → `/recommendations?force=true` redirect.

### Task 16: i18n strings + CLAUDE.md doc + PR

`he.cv = { ... }` block with all UI strings (drop zone, consent, status texts, archetype names, success messages).

Update `CLAUDE.md` with a "Phase 3b architecture" section (same template as 5a/5b/5c blocks).

PR title: *"Phase 3b: CV upload + skill extraction (streaming, interactive)"*.

---

## 4. Definition of Done

- [ ] User can drop a PDF or DOCX on `/cv` and see streaming extraction
- [ ] Reflection text streams character-by-character
- [ ] Skill cards bloom in one-by-one as LLM emits them
- [ ] User can tap a card to see evidence from CV
- [ ] User can dismiss/restore skills (tap-driven)
- [ ] User can add a manual skill via Hebrew autocomplete
- [ ] Category meter updates live as skills are toggled
- [ ] On save: `career_profile.data.skills` is updated; prior chat skills archived
- [ ] Success state shows archetype line + recommendations CTA
- [ ] Clicking CTA force-recomputes `/api/recommendations` and routes there
- [ ] Re-visiting `/cv` shows existing extraction (review state if not confirmed, success state if confirmed)
- [ ] lint + tsc + tests + build all pass
- [ ] CI green on PR
- [ ] Manual E2E in browser

---

## 5. Out of scope (Phase 3b.5 / 4.5 / 7)

- LinkedIn import (the master roadmap explicitly excludes)
- CV improvement suggestions ("your CV is missing X")
- Multi-CV support (keep only latest; an older CV's row stays but isn't surfaced)
- Phase 4.5 taxonomy expansion (currently 60 skills; needs to grow with occupation catalog)
- Hebrew nikud-aware autocomplete (taxonomy matching uses plain substring for MVP)

---

## 6. Known risks + mitigations

| Risk | Mitigation |
|---|---|
| `pdf-parse` chokes on scanned/image-only PDFs | Detect empty extracted text → friendly error message: *"לא הצלחנו לקרוא את הקובץ — אולי הוא סרוק? נסה PDF טקסטואלי או DOCX"* |
| LLM emits taxonomy ids that don't exist | Server validates each id against taxonomy; unknown ids get promoted to `other_skills` |
| User uploads PII-rich CV → privacy concern | Consent gate + 30-day deletion + stored text truncated to 50KB. CV files not surfaced anywhere in UI after upload. |
| Stream interrupts mid-extraction (network) | Server-side: extraction completes even if stream ends (write to DB happens in `result.object.then`). User re-opens `/cv` → resumes at review state with existing extraction. |
| LLM cost (long CV + ~5K cached system) | System prompt cached → subsequent extractions cost only the user-message tokens + output. First extraction is ~$0.02-0.04; cached subsequent extractions ~$0.01. |
| Streaming + Vercel | AI SDK v6 + Next.js App Router stream natively. Verified pattern in Phase 2 chat. |

---

## 7. Verification plan

After implementation:
1. **Unit:** `parse.ts` handles PDF + DOCX (fixture files); rejects bad mime; `archetype.ts` returns expected archetype for each category-mix.
2. **Integration:** `/api/cv/confirm` writes correctly to `career_profile`; existing chat skills are archived to `data.skills_from_chat`.
3. **Manual E2E (browser):**
   - Upload a real CV (the user's own, or a synthetic one)
   - Watch reflection stream + cards bloom
   - Dismiss 2 skills, add 1 manually
   - Confirm → see archetype
   - Click recommendations CTA → verify new recs reflect added skills
4. **Edge cases manually tested:**
   - Scanned PDF (empty extraction) → friendly error
   - 10MB+ file → client-side reject
   - .txt file → client-side reject
   - Streaming interrupted mid-flight (kill tab) → re-open `/cv` resumes correctly
