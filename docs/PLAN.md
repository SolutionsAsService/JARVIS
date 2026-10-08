# JARVIS codebase unification plan

Status: **IMPLEMENTATION IN PROGRESS. Phase 0 frontend and Phase 1a bounded local kernel implemented; complete agent-core/codebase consolidation remains pending.** Updated 2026-10-07.

## Task contract and correction

The ultimate target is **unifying reusable codebases into one ubiquitous intelligent assistant tool**, not a dashboard/control plane permanently coordinating independent OpenClaw, Freddie, Paperclip and router deployments. One JARVIS monorepo, shared kernel and product lifecycle must own identity, work, context and execution. This replaces the earlier adapter-only end-state; temporary compatibility shells are migration tools, not the final product.

Historical planning restriction superseded by the user’s October 7 authorization to build and publish a real consolidated kernel. Preserve the functional frontend and all user work; global runtime installations, paid inference and service/config changes are not implied. The planning draft was initially local-only; the user subsequently authorized publishing these documentation changes to main on October 7, 2026. Acceptance: coherent PLAN/CONTRACTS/README; pinned primary-source ledger; explicit ownership and migration gates; documentation diff and unchanged runtime paths.

## Phase 0 — historical shipped truth

Existing responsive frontend: six views, seeded sample skill registry, reversible overlap planning, MCP install proposals, local task-state demonstration, browser persistence and portable preview export. Task Lab does not launch agents/subprocesses; engine and DevHub connections remain planned. Existing test/build/browser evidence remains in VERIFICATION.md; this documentation update does not upgrade that evidence or claim a backend exists. Keep Phase 0 behavior compatible while implementation is separately authorized.

## Proposed end-state: one kernel, multiple surfaces

Browser / CLI / chat / device surfaces → authenticated ingress → **JARVIS kernel** → in-process capability services → scoped tools, model providers and external MCP servers. Ubiquity means shared identity and state across surfaces, not an unrestricted ambient assistant on every device.

Logical future monorepo boundaries (not empty directories to create now):

- **kernel:** canonical identity, tenant/workspace/task/run state, event ledger, scheduler, execution leases, deadlines, cancellation, process ownership and recovery.
- **context:** selective context assembly, memory lifecycle, artifact access, trust labels, provenance and token accounting; proposed JARVIS Context Protocol in CONTRACTS.md.
- **capabilities:** one catalog for tools, skills, service providers and MCP descriptors; separate skill and model routers.
- **governance:** Paperclip-derived goals, work queues, roles, approvals, cost reservations/accounting and audit views; these call kernel APIs, not their own dispatcher.
- **execution:** one embedded agent loop based initially on reusable OpenClaw agent-core boundaries; selectively extract Freddie service/provider and lifecycle primitives where they win conformance tests. Plugin effects cannot grant authority or start hidden task loops.
- **mcp:** first-class MCP client/catalog/lifecycle, using actual negotiated MCP semantics, not a competing protocol.
- **surfaces and compatibility:** retain current frontend; later normalize old session/tool interfaces temporarily. Remove duplicated runtime boot paths after migration gates.

Most domain services are in-process modules using shared versioned contracts. Sandboxed tool processes, native helpers, remote devices and third-party MCP servers may remain out-of-process for isolation; they are kernel-owned capabilities, not independent assistant schedulers. Language boundaries do not justify a second assistant runtime. No mandated deployment/database choice before target and upstream transaction needs are settled.

## Source reuse and overlap resolution

Evidence references below resolve to SOURCES.md, which distinguishes source inspection from execution proof.

- **OpenClaw [O]:** reuse documented agent-core/runtime, model transport, session/tool policy and channel/device boundaries. Proposed extraction is into JARVIS-owned packages; do not make unsupported imports from a separately installed Gateway's private internals the product architecture. Installed docs are evidence, not proof the source extraction compiles.
- **Freddie [F]:** reuse candidate scoped service definitions/providers, reversible lifecycle effects, reconstructable model-context/session-event ideas and subprocess teardown seam. Its default agent loop, teams, session ownership and boot tree overlap OpenClaw and kernel ownership; do not boot the full Freddie harness inside an OpenClaw agent turn. Preserve distinction between durable session facts and live agent events. The reviewed HTTP carrier lacks TLS/auth/origin policy and is not the public JARVIS API.
- **gm [G]:** bounded inspect/change/verify/finish workflow as policy and evaluation criteria, not another scheduler, required daemon or automatic recursive follow-up. Preserve original AnEntrypoint attribution plus fork adaptation credit.
- **Paperclip [P]:** derive governance, goal/work queue models, organization roles, approvals and cost reservation/accounting behavior. Its heartbeat dispatch, native/legacy execution and continuation machinery overlap task/run ownership. Extract selected domain services and tests; do not import heartbeat.ts wholesale or keep Paperclip heartbeats dispatching alongside JARVIS. The budget code explicitly notes reservations constrain admission but cannot cap an upstream provider bill.
- **agentic-router [R]:** distinct model-routing design/code candidate, not a skill router or work scheduler. Go request/decision contracts and hard eligibility/translation constraints, cluster strategy, catalog and explainable policy provenance are useful. **ELv2, not MIT:** extraction, porting and artifact redistribution are license-gated; a hosted/managed target requires an explicit licensing review/permission decision before reuse. A renamed TypeScript port does not remove obligations. A temporary Go policy worker may be kernel-owned; preferred final shape is an approved reusable library/in-process binding or independently authored replacement, never an independent assistant loop.

### Canonical ownership decision (proposed)

**ONE canonical scheduler: JARVIS kernel durable scheduler. ONE execution owner: JARVIS kernel execution supervisor. ONE embedded agent loop per run: OpenClaw-derived reusable core initially.** Governance emits work requests; routers emit decisions; skills emit guidance; none can self-schedule, launch a second harness, or bypass kernel tool authorization. Freddie loop/team schedulers and Paperclip heartbeat/native runner dispatch are retired from the consolidated boot graph, not layered underneath it.

Scheduler owns atomic admission, dependency-ready queues, finite retry budgets, fairness and capacity. Supervisor owns exact run/attempt/lease epoch, model dispatch and every process/worker handle. A worker is a bounded executor, never another authoritative task registry. Persist intent/accepted custody before acknowledgement; use fencing to prevent two owners after reconnect. Child work uses linked canonical tasks and decremented budgets (initial delegation depth 1), not opaque recursive spawning.

Lifecycle: queued → inspecting → changing → verifying → succeeded; permitted exits blocked/failed/cancelled/timed_out. Approval waiting and execution substates are explicit events. Terminal tasks never silently reopen; follow-up requires a new linked task. Cancellation is a request until owned work stops/reconciles; release physical resource leases only with cleanup evidence. Uncertain external mutation enters reconciliation, not blind replay or success. A cancellation/timeout may terminalize the task while separately retaining a quarantined cleanup lease; expose that distinction truthfully.

## Context, memory and provenance

Adopt the tentative **JARVIS Context Protocol (JCP), draft 0.1**, only as JARVIS internal versioned contracts and interoperability mappings. It is not an existing standard and does not replace MCP. CONTRACTS.md defines envelope, identity, authority, budget/deadline, trust, provenance, lifecycle and replay rules.

Every model request is reproducible from an access-controlled context manifest: governing instructions, selected skill revisions/dependencies, allowed tool schema hashes, task state, retrieval evidence and summaries with source links. Do not concatenate all installed catalogs or all tenants' memories. Tenant boundaries apply to retrieval, caching, artifacts, route telemetry and export. Evidence text is data, never elevated instructions. Summaries retain derivation and uncertainty; no silent promotion into stable user directives. Secrets remain scoped backend references; model/browser exposure requires a specific justified capability, not general context sharing.

## Two distinct routers

### Model router — agentic-router-derived candidate [R]

Input: authorized model/provider catalog snapshot, modality/tool/structured-output/translation needs, context footprint, budget, deadline, explicit operator pin and approved routing policy/artifact revision. Filter physical compatibility and policy permissions **before** quality/cost/latency ranking. Output: model+provider+runtime compatibility binding, reason, candidate exclusions, policy hash and estimated cost; dispatcher rechecks authorization and reserves budget. Context assembly and routing iterate boundedly if window size changes; no endless model/context oscillation.

Per-action routing must preserve conversation/tool-call/reasoning semantics, not silently translate unsupported unions. Decide permitted switching checkpoints and retain sticky routes where replay compatibility requires it. Approved fallback is bounded and recorded; no eligible route means blocked, not policy bypass. Upstream policy-sidecar docs explicitly reject hidden strategy fallback: JARVIS fallback is a separate, visible proposed policy, not a claim about upstream behavior. Test against fixed-model baselines, provider failures, unknown prices, oversized context and incompatible tool/history formats. README superlatives and mocked scorer tests are not independently verified performance benchmarks.

### Skill router — JARVIS capability selection

Skill identity includes source/runtime lineage, tenant visibility, workspace scope, logical name, revision/content hash and local customization, separate from capability identity. Permission, platform and license compatibility filters run before semantic suitability ranking. Use task intent, declared capabilities, tested triggers and behavior metadata, not name similarity alone. Preserve upstream precedence when importing; no silent overwrite of local forks.

Resolve dependency closure with cycle/unsatisfied-dependency checks, exact-content dedupe versus partial-capability overlaps, exclusive capability conflicts and context-token limits. Selection order: explicit authorized user/project pin; required capability coverage; tested semantic score; scope precedence; stable identity/revision lexical tie-break. If closure cannot fit, show omissions or block/request narrowing rather than silently dropping required dependencies. Return selected/rejected IDs, versions, reasons, conflicts, closure and token estimate. Deferred bodies load selectively; instructions cannot raise permission.

Evaluation: same-name different behavior, renamed duplicates, partial overlaps, hostile instructions, differing licenses, dependency cycles, deterministic ties and isolation. Use labeled replay fixtures plus real tasks when authorized; poor-confidence/failed evaluation falls back to a small explicit approved shortlist or asks the user, never generates executable SKILL.md or auto-installs skills. Migration/deduplication remains an approval-backed proposal with backup and rollback.

## MCP is first-class, not an installation checkbox

Catalog server identity/source/license/pin, configured endpoint and transport, negotiated protocol version, auth binding, discovered tools/resources/prompts, schema hashes, visibility, health and provenance. Support standard stdio and Streamable HTTP; legacy SSE only with explicitly tested compatibility. Lifecycle owns start/connect/initialize/discovery/refresh/drain/disconnect and bounded retries. Pin package/commit/container digest independently from protocol negotiation; schema drift invalidates cached grants/selection as policy requires.

Per-tool authorization is checked with tenant/requester identity and arguments at dispatch. Server auth (OAuth where applicable or scoped secret refs) is not blanket tool consent. Bound startup/request/idle timeouts, payloads, concurrency and output retention; SSRF/redirect checks and transport origin/TLS policy apply. Kernel supervises only JARVIS-owned stdio processes, never shared/user servers. Distinguish configured, reachable, healthy, authorized and invocation success. Record original MCP call ID, server/tool pin and source trust in JCP provenance without changing MCP wire meanings.

Installation remains planning until explicitly approved: discover → inspect exact source/digest/license/scripts and permission needs → propose scope/config diff/cost/rollback → approval bound to proposal hash → isolated/transactional install → health/conformance probe → receipt or rollback. Installing does not approve all future calls. Inspect/merge existing config; no auto-install assumption or global installer/remote skill replacement.

## Incremental extract/replace roadmap and gates

1. **Planning baseline (now):** approve architecture/ownership, review source/license matrix, obtain DevHub/deployment contracts. Gate: docs coherent and frontend truth preserved; no runtime mutation.
2. **Inventory and extraction design:** authorized read-only module/dependency inventory, per-file licenses/notices, test surfaces and native/language constraints. Select exact extraction candidates, identity/storage mappings and bounded APIs; do not bulk-vendor four products. Gate: maintainers/owners and patch provenance assigned; legal decision for [R]; baseline tests captured.
3. **Kernel contract vertical slice:** implement identity/event log/idempotency/lease supervisor/context manifest behind current frontend without booting upstream full runtimes. Database decision must account for Paperclip PostgreSQL transaction assumptions; SQLite is an option only after explicit redesign/conformance. Gate: duplicate submission, restart, stale lease, deadline, cancellation, tenant isolation, permissions and retained cleanup evidence; one terminal result, no orphan/duplicated mutation.
4. **Extract reusable execution/context services:** land OpenClaw-derived core and selected Freddie providers one at a time with original tests plus JARVIS conformance. Temporary shell maps exact native session/run IDs and event cursors; only one executor per task. Shadow mode is read-only normalization/decision comparison, never duplicate writes. Gate: reconstructable requests, tool policy denial, process-tree cleanup and replay; disable old loop/dispatch for migrated tasks.
5. **Consolidate governance and routing:** map Paperclip company→tenant, project→workspace and issue→task with explicit migration tables; preserve original IDs as provenance. Extract goals/approvals/cost services onto kernel state and retire heartbeat/native runner admission. Introduce separately evaluated model and skill routers; full MCP catalog/lifecycle with install preview only by default. Gate: costs conserved without double billing, goal/work dependencies correct, explainable routing, no hidden scheduler/fallback, authorization unchanged.
6. **Migrate and remove compatibility shells:** approved backups, checkpoints, paused admission, reconciliation, ID/event/artifact migration, ownership transfer with fencing, one route active at a time. Rollback restores data/config and original owner before resuming; never dual-write execution. Gate: loss/duplication/restart tests and measured acceptance; remove redundant boot paths, databases and scheduler timers only with explicit authorization. Final product runs consolidated code/services, not permanently federated engines.
7. **Ubiquitous surfaces and release:** DevHub plus agreed chat/device deployment, auth and result receipts; retention/redaction, observability, accessibility, migrations/backups, license/SBOM and threat review. Gate: real task→verified result→acknowledgement, isolation and rollback; representative controlled quality/cost/p50/p95 latency evaluation with immutable inputs/revisions. No claimed speedup without recorded comparable measurements.

## Code ownership and license preservation

JARVIS owns canonical contracts, kernel scheduling/supervision and integration changes. Upstream authors retain their original code ownership/copyright. Each extraction records repository, immutable revision, original path/hash, license, modifications, responsible maintainer and test provenance. Keep original notices plus third-party/transitive notices and mark modifications; JARVIS root MIT is not a blanket relicense. gm preserves AnEntrypoint MIT and Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService adaptation credit. Freddie preserves DeepSeek MIT; OpenClaw preserves Foundation MIT/third-party notices; Paperclip preserves Paperclip AI MIT. Router ELv2 and model/embedding artifact licenses are separately gated. No upstream implementation is copied this turn.

## Unresolved decisions and risks

- DevHub repository/version, auth, tenant mapping, event/result acknowledgement and evidence contract are unknown. No compatible endpoint is invented.
- Deployment target remains unknown: local/private versus third-party hosted, WSL/Windows/cloud/devices, public origin/subpath/SSO and Shadw account. This directly affects [R] licensing, transport and process ownership.
- Confirm source-level OpenClaw pin and actual package exports before extraction; installed version/docs are not a Git commit or execution benchmark.
- Choose data store/migration semantics after governance extraction inventory; do not pretend PostgreSQL row locks transplant unchanged into SQLite.
- Decide router reuse license clearance, Go in-process binding/port versus independently authored replacement, allowed model-switch boundaries and evaluation set.
- Confirm memory retention periods, redaction/legal hold policy, stable directive approval and organizational role model. Default deny/cross-tenant isolation until decided.
- Proposed ownership is settled in this plan; module feasibility/performance/security still require implementation proof. Rapid Freddie evolution and very large Paperclip heartbeat coupling make bulk merges unsafe.

Pinned primary-source claims and evidence paths: [SOURCES.md](SOURCES.md). Proposed envelopes and compatibility rules: [CONTRACTS.md](CONTRACTS.md).

## Phase 1a — implemented local kernel

See [KERNEL.md](KERNEL.md) for actual executable APIs, source extraction, tests, deployment and limitations. Native SQLite task/event custody, single local owner, finite execution, independently authored workflow/governance modules, OpenClaw-derived capability matching, deterministic skill routing and scoped JCP manifests now form one codebase. The official MCP SDK talks to a real owned stdio fixture. Model routing remains an eligibility decision without inference. Freddie lifecycle extraction, full Paperclip goals/roles/billing/PostgreSQL migration, real LLM loop, external MCP installation/auth and multi-device DevHub ingress remain gated future phases.
