# JARVIS implementation plan

Status: **Phase 0 frontend foundation implemented; backend phases not implemented.** Date: 2026-10-07.

## Product contract

One repo, one front door, one durable task owner. A user brings a project and outcome; JARVIS chooses explicit capabilities, retains ownership through execution, verifies outcomes and returns a terminal result. It does not keep spawning helpers or reopening completed work.

Scope now: a deployable frontend and concrete unification plan. Not now: repackaging OpenClaw/Freddie into a monolith, running unreviewed MCP installers, migrating/deleting user skills, changing the host Gateway, or claiming DevHub compatibility without its contract.

## Architecture

Browser → authenticated control-plane API → durable task registry / event log → one selected execution adapter → permitted tools. A capability registry resolves skill ownership before dispatch. Backend secret references never cross into browser configuration.

- **OpenClaw:** preferred session/orchestration boundary. Reuse documented APIs and existing permission gates; do not invent them.
- **gm:** bounded workflow policy (inspect/change/verify/finish), not a second scheduler or a runtime requirement.
- **Freddie:** optional plugin execution adapter, version-pinned and conformance-tested. Never simultaneous ownership of the same task as OpenClaw.
- **MCP:** server/tool protocol adapter with package provenance, reviewed transport, explicit install consent, bounded calls and scoped secrets.
- **DevHub:** project context and result delivery adapter. Endpoint, authentication, tenant model and schema are unknown until agreed.

One repository initially contains frontend, portable domain logic, adapter contracts, schemas and docs. Add backend/packages only when their implementation gates are met; no empty package forest.

## Phase 0 — show the system (delivered)

Responsive frontend; truthful disconnected states; reversible sample capability planning; finite-retry local state machine; nonsecret config export; build, unit tests and authored desktop/mobile E2E suite.

Exit: clean build and unit tests; inspect actual browser interactions when browser policy permits; explicitly disclose any verification limit. This is a prototype, not live agent orchestration.

## Phase 1 — real task ownership

Implement authenticated backend with SQLite for a single-node start and versioned migrations. Task identity includes project, actor, capability manifest hash, consent scope, adapter and idempotency key. Persist events before acknowledging acceptance. Stream updates with bounded reconnect/backoff, not repeated transcript inspection.

Task lifecycle: queued → inspecting → changing → verifying → succeeded, or blocked/cancelled/failed/timed_out. A completed task cannot reopen without a new explicitly linked task. A retry preserves identity and increments a finite budget. No retry after an uncertain external mutation before reconciling effects.

Each process has task owner, handle, deadline, attempt and cancellation signal. A watchdog must enforce deadlines independent of the browser. No missing-file-as-liveness assumption. Supervise child process groups, drain output within limits, handle termination escalation, and preserve checkpoints after restart. Max delegation depth initially 1; max concurrent workers configurable and bounded. No silent second executor. A timeout must produce a terminal event, not an infinite continuation.

Acceptance: kill/restart mid-task, lost acknowledgement, duplicate submission, stalled process, unavailable worker and cancellation tests all reach one truthful terminal disposition; no orphan process; no duplicated mutation; no retry storm.

## Phase 2 — adapters, not duplicate harnesses

Preserve native session keys, exact run IDs, submission identities, approval state and transcript cursors. Reconnect must reconcile accepted, persisted and completed states instead of blindly replaying. Cancellation requires reconciliation of owned process trees; a cancelled agent turn alone does not prove every child process stopped. Never kill shared/user-owned processes.

Implement OpenClaw first against a pinned supported version; prove a real read-only operation, then a scoped write with permission checks. Implement Freddie only after mapping its plugin lifecycle, context and cancellation semantics. Use the same canonical task id and normalized result envelope across adapters. gm policies never supersede host permissions.

The reviewed Freddie HTTP carrier has no built-in TLS, authentication or origin policy. Keep it loopback-only behind the authenticated JARVIS backend; never expose that carrier directly as the public API. Its live-agent events and durable session events are distinct. Preserve that distinction in the event adapter.

MCP installation flow: discover → inspect package/commit/digest/license and scripts → propose exact scoped changes → approval → transactional install → health check → receipt/rollback. Refuse mutable unknown versions by default. Package scripts are code. Do not combine installation approval with arbitrary later tool access. Inspect existing configuration and merge, never replace host config wholesale. Credentials are backend SecretRefs with tenant scoping. Network discovery needs SSRF protection and bounded payloads. No automatic global installers or remote skill replacement.

Acceptance: each adapter proves cancellation, permission-denied propagation, deadlines and structured evidence. A disconnected adapter cannot return success. Compatibility matrix pins versions and records tested capabilities.

## Phase 3 — one skill registry

Import manifests read-only. Federate runtime + workspace/scope + resolved name as installation identity, preserving each runtime’s precedence rules. Do not concatenate both runtime catalogs into a single prompt. Store stable identity, source, revision/hash, license, capabilities, dependencies, triggers, privilege requirements and tested compatibility. Exact-content duplicates and capability overlaps are different findings; similar names alone are not enough to merge skills.

Choose one owner per exclusive capability in a project policy. Show conflicts, reasons and alternatives. Proposed migration lists retained behavior, removed triggers, backups and rollback. User approval required before changing installed skills. Keep upstream attribution and customized local edits. Never silently overwrite a fork with upstream prose. Lint circular routing, recursive skill calls, exhaustive scope expansion and mandatory subprocess loops; runtime enforcement still lives in Phase 1.

Acceptance: fixtures include same-name different-behavior, renamed duplicates, overlapping partial capabilities, differing licenses, local modifications and dependency cycles. Migration preview is side-effect-free; rollback restores exact prior state.

## Phase 4 — DevHub handoff

Obtain actual DevHub repository/API and auth requirements. Agree on project id, task requests, attachment/evidence references, tenant identity and result acknowledgement. Define retry-safe submission and correlation. Host JARVIS under an allowed origin or subpath; agree frame/SSO policy, never wildcard credentialed CORS.

Acceptance: real DevHub request → one task → authorized adapter → real verification → acknowledged result. Retry a dropped response without duplicate execution. Test isolation across users/projects.

## Phase 5 — release hardening

Audit logging with redaction, retention policy, resource/concurrency limits, migrations/backups, dependency/license checks, security tests, accessibility and observability. Add load/chaos benchmarks; never claim measured speedups without comparable recorded data. Pin reproducible images and establish rollback before release.

## Risks and decisions

- Duplicate orchestration: resolved by ownership contract, not a merged README.
- A skill may instruct infinite work: enforce task budgets and terminal states in runtime.
- DevHub contract unknown: do not fake a compatible endpoint.
- Freddie developer preview changes: pin and gate adapter upgrades.
- Shadw target/account unknown: provide static artifact and platform-neutral serving; user deploys.
- Existing solution preflight: OpenClaw already orchestrates, gm already supplies policy, Freddie/gmfreddie already combine plugin execution. Reuse these; JARVIS adds a unifying control-plane contract.

## Source ledger

Inspected 2026-10-07: SolutionsAsService/gm skill and installer; SolutionsAsService/freddie README (developer preview, plugin architecture); SolutionsAsService/gmfreddie README (preloaded Freddie + gm-cc). These are integration inputs, not a compatibility guarantee. OpenClaw and MCP primary docs must be checked against pinned runtime versions during adapter implementation.

- https://github.com/SolutionsAsService/gm
- https://github.com/SolutionsAsService/freddie
- https://github.com/SolutionsAsService/gmfreddie
- https://docs.openclaw.ai/gateway
- https://modelcontextprotocol.io/specification

Independent contract review pinned Freddie at 5b300a13499fb74db55ec5aedfc3989a24fb29a8 and gm at d3099593736e725266e6fad07ff02df8d2e882ae. Reviewed Freddie docs/architecture.md, docs/subsystems/skills.md, docs/subsystems/subprocess.md and docs/subsystems/web-server.md, plus installed OpenClaw gateway/protocol/rpc-session-control.md, gateway/background-process.md and tools/skills.md. Reverify against deployment versions.

No upstream implementation is copied into this release. Preserve original licenses and provenance when future adapters vendor any upstream code or skill text.
