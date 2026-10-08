> **Phase 1a executable subset:** see [KERNEL.md](KERNEL.md). Task IDs/events, scoped HTTP, inline admission checks and JCP/0.1 context manifests are implemented. Wider envelope/memory/schema-negotiation contracts below remain proposed; no published protocol standard or complete schema coverage is claimed.

# Kernel contracts — live Phase 1a subset and proposed broader protocol

Planning draft, 2026-10-07. These are intended **JARVIS** internal boundaries, not claims that OpenClaw, Freddie, Paperclip, MCP or DevHub expose these methods/types. The local bounded task kernel is implemented; broader agent-runtime and governance consolidation is not. See PLAN.md for the single scheduler/execution owner and SOURCES.md for evidence.

## JARVIS Context Protocol — tentative JCP draft 0.1

Name/version tentative; **not an existing standard**. JCP describes JARVIS identity, context manifests and event exchange between consolidated modules/surfaces. MCP keeps its negotiated wire protocol, JSON-RPC IDs, tool/resource/prompt semantics and authorization flows; JCP wraps local provenance/correlation, not alternative MCP semantics. External adapters map losslessly where possible and explicitly report unsupported fields.

### Versioning and schemas

Proposed separately versioned JSON Schema contracts: Envelope, TaskEvent, ContextManifest, ContextItem, MemoryRecord, CapabilityDescriptor, RouteDecision, ExecutionReceipt and InstallationProposal. No runtime schemas are created this turn. Use explicit protocolVersion, schemaId/schemaVersion and schema hash. Major incompatibility fails closed; additive fields require documented handling; unknown authority/lifecycle enum values reject rather than defaulting to allowed/succeeded. Namespaced extensions cannot alter authority. Negotiate supported versions at module/transport boundaries and retain migrations plus golden compatibility fixtures.

### Envelope (illustrative field contract, not executable schema)

- **identity:** messageId, tenantId, workspaceId, actorId, sessionId?, taskId, runId?, attempt, parentTaskId?, correlationId, causationId. Kernel stamps authenticated actor/tenant and validates workspace membership; IDs supplied by a browser are not identity proof. Native IDs remain provenance, never replacement authority.
- **ordering:** kind, schemaVersion, occurredAt, acceptedAt, eventSeq?, ownerEpoch?, idempotencyKey?, payloadHash. Per-task committed sequence and lease epoch govern ordering; wall clock alone cannot. Identical content with different submission IDs is not automatically the same request.
- **authority:** authorizationSnapshotRef/hash, grantedCapabilities, resourceScopes, toolArgumentConstraints, approvalReceiptRefs, secretRefBindings and policyRevision. This is a projection of kernel authority, not client- or model-minted permission. Recheck current policy, cancellation and lease immediately before effects; child authority is an intersection, never a union.
- **budget:** reservationId, input/output/context token caps, cost units+currency, toolCall/step/retry/delegation caps, process/concurrency limits, deadlineAt and cancellationRef. Distinguish estimated/reserved/observed cost; enforce admission and ongoing limits server-side, acknowledge provider billing uncertainty.
- **context:** manifestRef/hash, itemRefs, selectedSkillRefs and allowedToolSchemaRefs. Large/secret-bearing bodies are access-controlled references with bounded retrieval, not unbounded inline logs.
- **provenance:** producer/module revision, upstream repo+commit/path where derived, source URI/artifact ID+content hash, retrieval time, trust tier, derivation/parent refs, evidence refs, redaction state and retention class.
- **payload:** typed data or authorized artifact ref; size/content limits and redaction apply before persistence, retrieval and egress. No credentials in browser exports or routing diagnostics.

### Trust and selective assembly

Proposed tiers: kernel-authored policy; authenticated user intent; approved/pinned workspace skill guidance; workspace content; external/tool/model-generated evidence. Tiers classify origin/instruction eligibility, not truth or infallibility. Workspace guidance applies only in its authorized scope and never supersedes host policy/user intent. Remote pages, MCP descriptions/results and retrieved documents remain untrusted data, even if TLS-authenticated or from an approved server. Summaries inherit all sources' risk; no laundering external instructions into trusted policy.

ContextItem: stable ID+hash, content/ref, source/derivation refs, tenant/workspace visibility, instruction-or-data role, trust tier, timestamps/freshness, estimated token size, sensitivity/redaction tags and retention class. ContextManifest captures exact included revisions/order, tokenizer/model catalog version, selected/rejected items with reasons, summary derivations and token allocations. Reserve space for output, tool responses and mandatory policy. Select required task/workspace guidance, skill dependency closure and relevant evidence under explicit quotas; compress optional data with source links or omit visibly, never silently truncate mandatory instructions. A request whose required context cannot fit blocks/asks for narrowing. Refresh authorization before materializing refs. Cache keys include tenant, policy, revision and redaction epoch.

### Memory lifecycle

Separate ephemeral run context, task checkpoints, workspace episodic evidence and explicitly approved durable user directives/organizational facts. Capture → classify/redact → scoped storage → retrieve with freshness checks → propose consolidation → authorized promotion → supersede/archive/expire/delete. Records carry source evidence, owner/scope, validity/expiry, confidence, supersedes links and consent. Generated claims are candidates, not automatically stable directives. User corrections replace conflicting active directives with preserved supersession history.

Retention periods are an unresolved policy decision: configure bounded TTLs before production, no implicit forever storage. Deletion/revocation propagates to derived summaries, embeddings, caches and artifact access; preserve metadata-only tombstones where replay/audit requires them. Record redaction revisions and make historical replay honor current authorization. Legal hold and backup expiry need an agreed policy. Request reproducibility uses manifests/hashes and authorized retained evidence; it does not override deletion or justify retaining secrets/raw content forever. Incognito/non-retained input keeps ephemeral manifests without durable bodies.

### Idempotency, replay, cancellation

Submission dedupe key is scoped to tenant/workspace/operation; same key+same payload returns prior custody/result, same key+different payload rejects. Persist accepted custody/event before acknowledgement and append effects/receipts through a transaction/outbox boundary. At-least-once transport does not imply exactly-once external side effects: use tool-specific idempotency receipts or reconcile uncertain mutations. Replay rebuilds projections without reissuing effects. Missing events/cursor gaps trigger bounded snapshot reconciliation, not optimistic success. Ended tasks require new linked task IDs to resume work.

Cancellation propagates task→run→tool/worker/process tree via owned signals. Task terminal status, cancellation acknowledgement and physical cleanup receipt are distinct. Quarantine unresolved cleanup/side effects while retaining ownership and resource reservation. Reject stale lease epochs; never kill shared/user-owned processes. Recovery acquires one fenced owner and reconciles prior accepted handles, deadlines and effects before dispatch. Terminal events cannot resurrect tasks through replay.

## Shared task/execution contract

JARVIS kernel scheduler admits work; execution supervisor owns all run/model/tool/process activity. Proposed module methods: admitTask(), appendEvent(), claimRun(), assembleContext(), selectCapabilities(), executeRun(), reconcileRun(), requestCancel(). These are module boundaries, not another public protocol or implemented endpoint.

ExecutionReceipt: taskId, runId, attempt, ownerEpoch, executorRevision, state, startedAt, finishedAt?, artifacts[], checks[], usage/reservation/accounting refs, process handles+cleanup disposition, failure?, reconciliationRequired?, nextAction?. Accepted/running are never succeeded. Checks include actual operation/exit/conclusion, tested revision, evidence reference and unit/mocked/live classification. Artifacts are scoped references, not secret-bearing raw logs. Parent completion depends on collected owned results, not announcing another helper.

Temporary compatibility modules preserve native session/run/submission IDs, event domains, approval state and transcript cursors. Map live notifications separately from durable facts; reconciling a disconnected source is not execution success. Conformance must prove deadlines, permission denial, replay, cancellation and cleanup before a source service replaces an implementation. No nested upstream scheduler or harness boot is permitted.

## Capability catalog and separate route decisions

CapabilityDescriptor: canonical capability ID, provider identity, tenant/workspace visibility, source/runtime lineage, revision/content/schema hashes, license, required permissions/resources, dependency IDs, exclusive-conflict set, tested platform/runtime compatibility and health. Skill descriptors additionally include instruction scope, triggers, semantic features, token estimate and customization/override lineage. Tools carry argument/input/output schema pins; names are display labels, not identity.

**SkillSelectionDecision:** authorized task/context/policy revision, ranked candidate IDs, exclusions, deterministic tie-break, selected IDs+dependency closure, dedupe/conflict findings, token allocation and confidence/evaluation revision. Permission/license filters precede ranking. Exact duplicates differ from overlapping behavior; no destructive dedupe before approved migration. Low confidence uses an approved shortlist or asks; never invents/installs executable skills.

**ModelRouteDecision:** action ID, catalog/policy/artifact revision, model/provider binding, hard compatibility constraints, excluded candidates/reasons, cost/latency/quality estimates, explicit pin, switching constraints and approved fallback policy. Model ranking cannot grant tools/select skill authority. Kernel dispatch owns credential access, authorization, retries and billing; policy inference alone does not dispatch. Upstream agentic-router code reuse is ELv2-gated, and its optional sidecar policy semantics are not silently rewritten as JARVIS fallback behavior.

## MCP catalog and lifecycle contract

McpServerDescriptor: scoped serverId, source/package/commit/digest+license, installation receipt?, endpoint/stdio argv+cwd ref, transport, negotiated protocolVersion, auth/SecretRef binding, catalog revision, tool/resource/prompt schema refs, health/reachability timestamp, timeout/concurrency policy and provenance. A descriptor is not authorization. ToolIdentity includes serverId+pin+toolName+schemaHash; bind grants to defined scope and revalidate schema drift.

Lifecycle: proposed → approved/configured → starting/connecting → initialized/discovered → healthy/degraded → draining/stopped. Unavailable/backoff/auth-required are explicit. Native MCP requests/responses/cancellation preserve their protocol rules; JCP correlates them to task/run/call/evidence IDs. Every invocation rechecks permissions, arguments, deadline and requester/server binding. No automatic network discovery or server installation just because a skill mentions a tool.

InstallationProposal: exact pinned source, license/script review, install scope, affected files/config diff, required privileges/network/budget, approval hash, health probe and rollback/backup plan. Separate install approval from tool execution grants. Health receipts distinguish configuration validity, reachability, authentication and actual tool conformance. Existing configs are inspected/merged; shared servers are not terminated by a task cancel.

## Frontend export v1 — unchanged implemented preview

kind: jarvis.deployment-plan; mode: preview; schemaVersion: 1; enabled sample skill ids; planned adapters (connected:false); MCP proposals (installed:false); proposed DevHub endpoint; bounded executionPolicy; secretsIncluded:false. See ../schemas/stack-plan.schema.json. JCP draft is separate from this historical export schema; do not reinterpret exported adapter choices as live kernel implementations.

Never pass an untrusted client plan to a shell/installer. Future backend revalidates IDs, privileges, URLs, tenant ownership, pins and approval receipts. The current preview deadline is checked on action only; real runtime deadlines require server-side enforcement. No runtime API/schema migration occurs in this documentation turn.

## DevHub and deployment discovery

DevHub repository/version, identity/auth ownership, tenant/project mapping, submission acknowledgement/idempotency, attachments/evidence schema, event callbacks and cancellation contract remain unknown. Agree allowed origin/subpath/frame/SSO and cross-user isolation before claiming integration; never wildcard credentialed CORS. Deployment must identify local/private versus hosted use, supported devices/process custody and retention policy; router license eligibility is a release gate, not a presumed permission.
