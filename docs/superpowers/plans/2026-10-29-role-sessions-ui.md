# Role sessions and admin interface

Goal: Admin and starosta remain signed in until explicit logout; kurator uses tab session storage. Preserve password-derived roles, existing permissions, encrypted data, collapsed account actions and nonblocking cloud login.

Approach: Keep the current plain JavaScript application and olive visual identity. Store admin/starosta credentials in localStorage with no local expiry; keep kurator only in sessionStorage. Migrate existing privileged sessions; discard legacy curator credentials from localStorage. Server admin bearer uses expires_at=0 as an explicit no-expiry sentinel, still revoked by logout and vault rotation. No plaintext passwords are stored.

UI: A clearer single password form with role-specific persistence explanation, visible password toggle and loading/error states. A consistent application masthead, accessible section navigation, session role/status, larger form controls and coherent desktop/mobile layouts across schedule, attendance and users. Account deletion stays inside details.

- [ ] Add behavior tests for persistent sessions, curator storage, migration, stale cloud and server revocation.
- [ ] Implement role storage and no-expiry cloud bearer without weakening permissions or network independence.
- [ ] Refine login, shared navigation and working surfaces; retain all editing flows.
- [ ] Run both complete test suites and inspect synthetic desktop/mobile UI.
- [ ] Review, commit, publish and verify the deployed assets/services.

Review focus: cloud 401 must not log out the whole app; background login must not overwrite a replacement session; expired legacy admin can migrate; curator local storage must not survive a restart; logout and vault rotation must revoke indefinite server tokens.
