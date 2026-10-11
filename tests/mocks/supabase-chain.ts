import { vi, type Mock } from "vitest";

export type QueryResult<T = unknown> = { data: T; error: unknown };

/**
 * A chainable stand-in for Supabase's PostgrestFilterBuilder.
 *
 * The real builder returns itself from every filter method, so a route is free to chain
 * `.eq().eq()` or `.eq().order().limit()` and finish with `.maybeSingle()` — or by awaiting
 * the builder directly. Hand-rolled mocks that return a different literal per step encode
 * one exact call sequence, so they break the moment a route adds a filter. That is how
 * tests/unit/db/cv-confirm-multi-row.test.ts drifted out of sync with
 * app/api/cv/confirm/route.ts when a second `.eq("conversation_id", …)` was added:
 * `.eq(...).eq is not a function`.
 *
 * `results` is consumed one entry per terminal call (`maybeSingle`, `single`, or awaiting
 * the builder), so a test can script a first query resolving null and a fallback query
 * resolving a row. The last entry repeats once exhausted.
 */
export interface ChainQuery {
  select: Mock;
  eq: Mock;
  order: Mock;
  limit: Mock;
  insert: Mock;
  maybeSingle: Mock;
  single: Mock;
  then: <T1, T2 = never>(
    onFulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ) => Promise<T1 | T2>;
}

export function chainQuery(results: QueryResult[] = []): ChainQuery {
  let i = 0;
  const take = (): QueryResult =>
    results.length === 0
      ? { data: null, error: null }
      : results[Math.min(i, results.length - 1)] ?? { data: null, error: null };
  const takeAndAdvance = (): QueryResult => {
    const r = take();
    i += 1;
    return r;
  };

  const q = {} as ChainQuery;
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.order = vi.fn(() => q);
  q.limit = vi.fn(() => q);
  q.insert = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => Promise.resolve(takeAndAdvance()));
  q.single = vi.fn(() => Promise.resolve(takeAndAdvance()));
  q.then = (onFulfilled, onRejected) =>
    Promise.resolve(takeAndAdvance()).then(onFulfilled, onRejected);
  return q;
}
