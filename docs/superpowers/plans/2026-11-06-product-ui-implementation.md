# Product UI implementation plan

**Goal:** Apply the approved compact Ramp UI across all existing product pages.
**Architecture:** Keep React components, controller, API and scoring unchanged. Replace shared visual tokens and component markup; keep device checks and consent between setup and room. Pick an existing bank topic on entry and reveal it in the existing room phase.
**Tech Stack:** React 19, TypeScript, Tailwind 4, Vite.
**Spec:** ../specs/2026-11-06-product-ui-design.md (v1.4 overrides earlier conflicting text).

## Constraints and review focus
- No model, API, database, wallet transaction or scoring changes.
- Two interviewers by default; three LGD AI candidates; all existing validation retained.
- LGD native radios, compact two columns, centered 360x60 entry button; no question preview.
- Room/report have only a small home button, no product navigation.
- Verify long text, 360px layout, reading timer phase transition, error/retry, privacy controls and optional wallet/cert states.

## Tasks
1. Shared system: replace dark tokens and glass effects with warm canvas, white surfaces, readable type, neutral controls and semantic states. Preserve component class hooks; recolor all page/modal JSX utilities. Check typecheck/build and all page renders.
2. Setup and shell: replace bank controls with radios; use pickTopic at submit, preserve validateSetup and candidate matching. Keep DeviceCheck onStart path. Remove nav on room/report and size room to viewport minus home control. Verify all four topic categories and two interview modes.
3. Room: simplify nested frames, retain transcript/input/controls, show topic prominently during actual LGD reading phase with live existing countdown. Do not skip or alter phase timers. Verify topic view, phase progression, mobile controls.
4. Report/device/settings/privacy/wallet/certificate: apply shared tokens and simplify borders; retain all information and actions. Check loading/error/evidence and optional transaction presentation.
5. Run npm verify; inspect desktop/mobile actual components with synthetic UI-only fixtures where hardware/model services would otherwise be required. Independent final review; fix material issues; local commit, no deployment.

## Progress / decisions
- Baseline: branch codex/ui-design-review; existing design-only edits are approved prototypes, retained.
- Ruling: continue in existing dedicated UI branch, no extra worktree or repeated approval; user explicitly asked to implement now.
- Ruling: entry label is “进入面试房间”; existing device permission/consent screen still runs before room, as agreed UI-only boundary requires.

- Tasks 1–4 complete: all existing pages and optional component surfaces updated; no dependencies added.
- Verification: 322 tests pass; typecheck/build/functions/secrets/bundle pass. Browser checked actual component fixture at desktop and360px, no horizontal overflow; mobile room toolbar bottom615.3 <640. Fixture kept only in ignored .temp, not part of deployment.
- Independent review: no important business regressions. Narrow panel dimension heading checked and given wrapping + fixed score sizing. Background transcript/controls inert while reading overlay covers them.
- Task5: final verification and local commit; production deployment not requested in this turn.

- Final verification note: one concurrent run hit the pre-existing 250ms scheduler assertion in session-store.test.ts (no engine diff). Isolated rerun passed 9/9; full rerun passed 322/322. Compiler API with project config/current-directory also returned zero diagnostics. No production logic changed to accommodate the timing-sensitive test.
