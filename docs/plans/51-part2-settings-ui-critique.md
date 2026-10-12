# #51 part 2 — Codex plan critique

The plan covers most of #51’s UI requirements and correctly preserves the consent exemption, server-side analytics, client-safe confirmation token, and Hebrew i18n structure. **Resolve the P1 findings before implementation.**

1. **P1 — Visiting `/settings` can erase the rejected-session signal.**  
   [Plan §3.1](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:38) assumes `resolveRequestIdentity()` will detect rejected credentials. However, `lib/supabase/middleware.ts` exempts only `/api/me*`; on `/settings`, it runs `getUser()` and can clear rejected session cookies before rendering. The page and subsequent DELETE can then operate on the anonymous footprint while the signed-in account remains—the failure already addressed for API routes in critique item 11.  
   **Fix:** Extend the identity-preservation design to `/settings`, accounting for valid-session refresh and RSC cookie-write restrictions. Add a proxy-through-page/API regression test with rejected auth credentials plus a live anonymous cookie; require reauthentication rather than anonymous fallback.

2. **P1 — An unapplied deletion RPC is not harmless.**  
   [Scope](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:12) says a missing function merely produces a retry banner. In `lib/privacy/delete.ts`, storage removal happens **before** `delete_user_data`. If the lock columns exist but the RPC is missing, CV files can be permanently removed before the request fails.  
   **Fix:** Gate enabling the UI/API on successful migration deployment and real-Postgres verification. Keep `DATA_RIGHTS_ENABLED=false` until ready; explicitly document that earlier stages can have completed when deletion fails.

3. **P1 — Partial storage cleanup is presented as complete erasure.**  
   [Delete success handling](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:77) intentionally ignores `complete:false`, then displays the same “data deleted” notice. The actual route explicitly uses this response when storage objects may remain and user retries cannot find them.  
   **Fix:** Parse the success body and show a distinct notice: account and database data deleted, file cleanup incomplete and reported for follow-up. Preserve that distinction through navigation, avoid offering an ineffective retry, and test both success variants.

4. **P2 — “Export first” can race irreversible deletion.**  
   [Dialog design](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:73) creates another `useDataExport()` instance, while confirmation depends only on typed text and deletion state. Users can start an export and immediately delete; the export’s multiple reads can fail or return an incomplete snapshot.  
   **Fix:** Share export state between panel and dialog. Block deletion while export is pending, and block export while deleting. Test both entry points with a deferred export response.

5. **P2 — Focus restoration is assumed but not wired.**  
   [Panel design](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:64) uses an external button controlling a separate dialog. Radix’s installed implementation restores focus through its `DialogTrigger` ref; an ordinary external button does not populate it.  
   **Fix:** Put a `DialogTrigger asChild` within the same dialog root, or explicitly restore the opener ref in `onCloseAutoFocus`. Test Cancel, Escape, and close-button dismissal, plus confirmation reset on reopening.

6. **P2 — The non-dismissable pending state has no bounded recovery.**  
   [Pending behavior](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:79) disables every exit until fetch settles. A stalled connection can leave the user trapped indefinitely; server `maxDuration` is not a client timeout.  
   **Fix:** Define a bounded waiting period and an “outcome unknown” state that permits dismissal and explains retry behavior. Aborting the client request must not imply server deletion was cancelled. Test a never-settling request and recovery.

7. **P2 — Retention promises exceed the repository’s evidence.**  
   [Privacy copy](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:100) promises that deleted data no longer exists in backups after 90 days. However, `docs/runbooks/db-backup.md:26` recommends monthly offsite copies for longer retention. The 30-day CV lifecycle is documented as external configuration, not established by executable repository code.  
   **Fix:** Reconcile offsite retention with the proposed policy and require deployment evidence for CV expiry. Describe verified retention boundaries rather than guaranteeing erasure across every backup copy.

8. **P2 — The proposed a11y tests miss the destructive dialog’s actual browser behavior.**  
   [Smoke coverage](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:123) makes opening the dialog optional. Scanning the closed settings page cannot validate its focus trap, keyboard interaction, or overflow. Existing `DialogContent` has no viewport-height limit or scrolling; the long deletion list plus an error banner can push controls outside a small viewport.  
   **Fix:** Require browser checks with the dialog open, including error and pending states. Add bounded height and scrolling; test Tab/Shift+Tab, Enter/Space guards, focus return, and visible controls at narrow widths and zoom. Verify RTL footer order against keyboard order.

9. **P3 — The i18n guard can miss the files it intends to protect.**  
   [Static test](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:148) specifies `**/*.tsx?`; ordinary glob syntax does not interpret that as “`.ts` or `.tsx`.” It also requires every file to import `he`, even when a component legitimately receives translated props.  
   **Fix:** Use `**/*.{ts,tsx}`, assert the matched file set is nonempty and includes expected files, and check for Hebrew literals independently of import style.

This was a static plan/code review using the issue criteria reproduced in the parent plan. No files were modified or tests run.
tokens used
56,031
The plan covers most of #51’s UI requirements and correctly preserves the consent exemption, server-side analytics, client-safe confirmation token, and Hebrew i18n structure. **Resolve the P1 findings before implementation.**

1. **P1 — Visiting `/settings` can erase the rejected-session signal.**  
   [Plan §3.1](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:38) assumes `resolveRequestIdentity()` will detect rejected credentials. However, `lib/supabase/middleware.ts` exempts only `/api/me*`; on `/settings`, it runs `getUser()` and can clear rejected session cookies before rendering. The page and subsequent DELETE can then operate on the anonymous footprint while the signed-in account remains—the failure already addressed for API routes in critique item 11.  
   **Fix:** Extend the identity-preservation design to `/settings`, accounting for valid-session refresh and RSC cookie-write restrictions. Add a proxy-through-page/API regression test with rejected auth credentials plus a live anonymous cookie; require reauthentication rather than anonymous fallback.

2. **P1 — An unapplied deletion RPC is not harmless.**  
   [Scope](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:12) says a missing function merely produces a retry banner. In `lib/privacy/delete.ts`, storage removal happens **before** `delete_user_data`. If the lock columns exist but the RPC is missing, CV files can be permanently removed before the request fails.  
   **Fix:** Gate enabling the UI/API on successful migration deployment and real-Postgres verification. Keep `DATA_RIGHTS_ENABLED=false` until ready; explicitly document that earlier stages can have completed when deletion fails.

3. **P1 — Partial storage cleanup is presented as complete erasure.**  
   [Delete success handling](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:77) intentionally ignores `complete:false`, then displays the same “data deleted” notice. The actual route explicitly uses this response when storage objects may remain and user retries cannot find them.  
   **Fix:** Parse the success body and show a distinct notice: account and database data deleted, file cleanup incomplete and reported for follow-up. Preserve that distinction through navigation, avoid offering an ineffective retry, and test both success variants.

4. **P2 — “Export first” can race irreversible deletion.**  
   [Dialog design](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:73) creates another `useDataExport()` instance, while confirmation depends only on typed text and deletion state. Users can start an export and immediately delete; the export’s multiple reads can fail or return an incomplete snapshot.  
   **Fix:** Share export state between panel and dialog. Block deletion while export is pending, and block export while deleting. Test both entry points with a deferred export response.

5. **P2 — Focus restoration is assumed but not wired.**  
   [Panel design](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:64) uses an external button controlling a separate dialog. Radix’s installed implementation restores focus through its `DialogTrigger` ref; an ordinary external button does not populate it.  
   **Fix:** Put a `DialogTrigger asChild` within the same dialog root, or explicitly restore the opener ref in `onCloseAutoFocus`. Test Cancel, Escape, and close-button dismissal, plus confirmation reset on reopening.

6. **P2 — The non-dismissable pending state has no bounded recovery.**  
   [Pending behavior](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:79) disables every exit until fetch settles. A stalled connection can leave the user trapped indefinitely; server `maxDuration` is not a client timeout.  
   **Fix:** Define a bounded waiting period and an “outcome unknown” state that permits dismissal and explains retry behavior. Aborting the client request must not imply server deletion was cancelled. Test a never-settling request and recovery.

7. **P2 — Retention promises exceed the repository’s evidence.**  
   [Privacy copy](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:100) promises that deleted data no longer exists in backups after 90 days. However, `docs/runbooks/db-backup.md:26` recommends monthly offsite copies for longer retention. The 30-day CV lifecycle is documented as external configuration, not established by executable repository code.  
   **Fix:** Reconcile offsite retention with the proposed policy and require deployment evidence for CV expiry. Describe verified retention boundaries rather than guaranteeing erasure across every backup copy.

8. **P2 — The proposed a11y tests miss the destructive dialog’s actual browser behavior.**  
   [Smoke coverage](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:123) makes opening the dialog optional. Scanning the closed settings page cannot validate its focus trap, keyboard interaction, or overflow. Existing `DialogContent` has no viewport-height limit or scrolling; the long deletion list plus an error banner can push controls outside a small viewport.  
   **Fix:** Require browser checks with the dialog open, including error and pending states. Add bounded height and scrolling; test Tab/Shift+Tab, Enter/Space guards, focus return, and visible controls at narrow widths and zoom. Verify RTL footer order against keyboard order.

9. **P3 — The i18n guard can miss the files it intends to protect.**  
   [Static test](/workspace/projects/careeros/lai-51/docs/plans/51-part2-settings-ui.md:148) specifies `**/*.tsx?`; ordinary glob syntax does not interpret that as “`.ts` or `.tsx`.” It also requires every file to import `he`, even when a component legitimately receives translated props.  
   **Fix:** Use `**/*.{ts,tsx}`, assert the matched file set is nonempty and includes expected files, and check for Hebrew literals independently of import style.

