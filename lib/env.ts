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

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

const isServer = typeof window === "undefined";

function loadClientEnv(): ClientEnv {
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
    throw new Error("Invalid client environment variables");
  }
  return parsed.data;
}

function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "❌ Invalid server environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid server environment variables");
  }
  return parsed.data;
}

/**
 * Public env (NEXT_PUBLIC_* only). Safe to use in client and server code.
 */
export const clientEnv: ClientEnv = loadClientEnv();

/**
 * Server-only env including secrets. Files that import this MUST also
 * `import "server-only"` so the bundler refuses to ship them to the browser.
 *
 * On the client this is a Proxy that throws on any property access — defense
 * in depth in case a `server-only` guard is missed during refactoring.
 */
export const serverEnv: ServerEnv = isServer
  ? loadServerEnv()
  : new Proxy({} as ServerEnv, {
      get(_target, prop) {
        throw new Error(
          `serverEnv.${String(prop)} accessed on the client — the importing file must have \`import "server-only";\``,
        );
      },
    });
