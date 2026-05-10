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

type ServerEnv = z.infer<typeof serverEnvSchema>;

const isServer = typeof window === "undefined";

function loadEnv(): ServerEnv {
  if (isServer) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error(
        "❌ Invalid server environment variables:",
        parsed.error.flatten().fieldErrors,
      );
      throw new Error("Invalid environment variables");
    }
    return parsed.data;
  }
  // Client side: only NEXT_PUBLIC_* are available. Validate the subset, then
  // return as ServerEnv with server-only fields left undefined. Next.js's bundler
  // ensures server-only files (with `import "server-only"`) are never bundled into
  // client code, so client code cannot accidentally read SUPABASE_SERVICE_ROLE_KEY etc.
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) {
    console.error(
      "❌ Invalid client environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment variables");
  }
  return parsed.data as ServerEnv;
}

export const env = loadEnv();
