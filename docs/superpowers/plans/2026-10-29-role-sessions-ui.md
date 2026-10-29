# Role sessions and admin interface

Goal: Admin and starosta remain signed in until explicit logout; kurator uses tab session storage. Preserve password-derived roles, existing permissions, encrypted data, collapsed account actions and nonblocking cloud login.

Approach: Keep the current plain JavaScript application and olive visual identity. Store admin/starosta credentials in localStorage with no local expiry; keep kurator only in sessionStorage. Migrate existing privileged sessions; discard legacy curator credentials from localStorage. Server admin bearer uses expires_at=0 as an explicit no-expiry sentinel, still revoked by logout and vault rotation. No plaintext passwords are stored.

UI: A clearer single password form with role-specific persistence explanation, visible password toggle and loading/error states. A consistent application masthead, accessible section navigation, session role/status, larger form controls and coherent desktop/mobile layouts across schedule, attendance and users. Account deletion stays inside details.

- [x] Add behavior tests for persistent sessions, curator storage, migration, stale cloud and server revocation.
- [x] Implement role storage and no-expiry cloud bearer without weakening permissions or network independence.
- [x] Refine login, shared navigation and working surfaces; retain all editing flows.
- [x] Run both complete test suites and inspect synthetic desktop/mobile UI.
- [x] Review, commit, publish and verify the deployed assets/services.

Review focus: cloud 401 must not log out the whole app; background login must not overwrite a replacement session; expired legacy admin can migrate; curator local storage must not survive a restart; logout and vault rotation must revoke indefinite server tokens.

Review: cross-tab cached credentials now invalidate on sessionId removal/replacement and refresh the UI; the masthead listens for every role change. Independent review found no remaining blocker. Preserved and merged newer attendance publishing code; its writer sessions use the same role lifetime policy (admin/starosta no expiry, curator session storage plus bounded server token).

Completed 2026-10-29: admin45/45 and application77/77 tests pass. Pages run40934759803 succeeded for bfaa2814. Render API deployment dep-dbhpe2oae00c73ec5lp0 is live at abe95e40. Auto-deploy did not run (last live remained Oct27 after push); recovered with one explicit deployment after verifying no pending run. Health200, unauthenticated Users401, exact-origin CORS and no-store confirmed. Published login inspected; desktop/mobile synthetic checks covered all three tabs, curator permissions, loading/error and collapsed account controls. No real credentials were submitted and no student records changed.
