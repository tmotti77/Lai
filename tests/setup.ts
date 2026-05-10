// Provides stub env vars before any test file is imported, so lib/env.ts's
// zod validation passes and downstream server-only modules can be imported in tests.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
process.env.ANTHROPIC_API_KEY = "stub-anthropic-key";
process.env.ANTHROPIC_MODEL = "claude-stub";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
