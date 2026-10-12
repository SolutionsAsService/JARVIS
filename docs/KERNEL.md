# JARVIS Phase 1a — real local kernel

October 7, 2026. Implemented foundation, not a complete AI assistant or full upstream merger.

## Run

Requires Node >=24.15.0 (native SQLite and type stripping).

```sh
npm ci
npm test
# Set a private, randomly generated session token only in your backend terminal:
export JARVIS_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run start:kernel
```

Open `http://127.0.0.1:8787/?kernel=local`. Enter your token into the opt-in Local kernel panel; it is cleared from the input after connection and held transiently, not localStorage. The six original preview views remain visibly sample/simulation data. Live text-digest tasks have real durable IDs, routing/context receipts, phases, results and events. Read/Cancel are actual API actions, not simulated Task Lab actions. Disconnect clears the transient client. Do not submit secrets: task input is persisted locally.

The CLI binds loopback only and permits `text.digest`, an owned finite hashing operation. It is deliberately not arbitrary shell, model inference or a claim of AI intelligence. `PORT` changes the port; `.jarvis/state.sqlite` stores tasks/events. Never embed JARVIS_TOKEN in a frontend build, source control, exported plan or browser storage. Restart with the same token binding to resume queued custody; claimed execution fails reconciliation instead of replaying uncertain effects.

## Actual executable APIs

All `/api/` endpoints require Bearer authorization, the configured actor/workspace scope, loopback Host and same-origin Origin if supplied. No permissive CORS.

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/health` | Actual local supervisor state; `inference:false` |
| POST | `/api/tasks` | Admit workspace, idempotencyKey, text, optional bounded delayMs/timeoutMs/goalId/operation |
| GET | `/api/tasks/:id` | Scoped task, context/approval/routing receipts and ordered events |
| POST | `/api/tasks/:id/cancel` | Request cancellation; no fake stopped result before owned work returns |
| POST | `/api/skills/route` | Workspace, capabilities, intent, budget; deterministic selected/rejected reasons |
| POST | `/api/models/route` | Workspace/pin; no configured inference provider in this deployment, explicitly blocked |
| POST | `/api/mcp/preview` | Workspace/id/pin/license/transport; project-only proposal, no installation |

Tasks admit at most 4096 JavaScript string code units, delay 0–500ms, deadline 10–10000ms; HTTP JSON body max8192 bytes is an additional limit. One active supervisor task, one attempt, at most100 unfinished tasks per tenant,10000 task retention capacity. The digest result is SHA256+character count. Explicit idempotency key reuse with a different normalized payload is a409 conflict. Cancellation and deadlines are terminal after owned cleanup; completed tasks never reopen. No provider billing/accounting occurs.

## Consolidation, not parallel runtimes

- `kernel/store.js`: SQLite transactional tasks/events/idempotency with WAL. A local PID/nonce ownership record rejects a second live supervisor before recovery. This is single-host/single-owner storage, not distributed scheduling or a Paperclip/PostgreSQL migration. A stale or reused PID can require operator reconciliation; do not blindly delete a live owner.
- `kernel/kernel.js`: canonical task/run identities, ownership epochs, lease renewal/stale-result rejection, restart/cancel/deadline handling. Queued tasks survive and are drained on HTTP startup under their original actor binding; absent bindings do not silently impersonate their owners.
- `kernel/catalog.js`, `skill-router.js`: actual bounded workflow policy routes into each admitted task and JCP manifest. This policy encodes gm-style finite work without daemon/recursive continuation. Deny rules win, logical-ID collisions reject, exact content duplicates are reported, dependencies/cycles/conflicts/budgets are checked. Heuristic scoring is not semantic model inference; a content hash is not a signed publisher identity.
- `kernel/context.js`: JCP/0.1 scoped manifest, provenance/hash, trust role separation, mandatory input admission, chars/4 token estimate. It does not infer trustworthy origin from external text; authenticated callers supply trusted metadata. This is not a complete memory/retention/redaction subsystem or standard protocol.
- `kernel/governance.js`: independently authored scoped work-approval receipts and integer admission budgets. No real Paperclip roles/goals/work queues/provider cost ledger or human approval workflow is claimed.
- `kernel/vendor/openclaw`: actual MIT glob matcher/regexp code extracted unchanged from immutable upstream pin, original license/hashes preserved. Runtime shim is separate. The extracted matcher is used for capability authorization, including routing/governance.
- `kernel/mcp.js`: official SDK, owned stdio fixture initialize/list/schema-hash grant/invoke/cleanup. Code-hash pin checked before effects. Tests use a real child process. Registry and grants are currently in-memory; external descriptors produce proposals only. Streamable HTTP/OAuth/resources/prompts/installation are not implemented merely because a proposal names a transport.
- `kernel/model-router.js`: separate independently authored eligible-provider/pin/cost decision, zero configured providers, no inference; no agentic-router ELv2 code was copied or ported.

Freddie subprocess services and Paperclip accounting were inspected but cannot be honestly vendored alone without their coupled runtime/terminal/database semantics. Next extraction must prove conformance and remove duplicate ownership, not boot additional upstream loops. See [SOURCES.md](SOURCES.md).

## Verification and remaining gates

`npm test` builds frontend first and runs original sample UI tests plus durable kernel/restart/single-owner/cancellation/idempotency/auth/tenant isolation/router/context/MCP/extraction hash/live-handler/real HTTP tests. Test credentials are test-only literals. `npm run test:kernel` also builds prerequisites. JSDOM UI tests are not visual proof; previous browser CI was for an older frontend. Local browser navigation remains policy-blocked; no bypass used.

Not yet: real LLM loop, provider credentials/inference evaluations, goal hierarchy/billing, external MCP installation/OAuth, full memory retention, distributed/multi-device ingress, hosted auth/TLS, DevHub contract, kernel container deployment or full upstream test suites. Existing Docker/static build serves the preview only. No host runtime configuration or daemon installs were performed.

## Phase 1b adapters (2026-10-12)

Both adapters are optional and **off by default**; the kernel boots and tests pass without either external system.

- kernel/adapters/paperclip.js: createPaperclipClient (GET /api/health, /api/companies?scope=accessible, /api/companies/:id, /api/companies/:id/agents, /api/agents/:id, /api/companies/:id/issues, /api/issues/:id, PATCH /api/issues/:id with Prefer: return=minimal, POST /api/issues/:id/comments, approvals, heartbeat-runs; POST /api/agents/:id/heartbeat/invoke only with allowPaperclipDispatch:true). paperclipConfigFromEnv returns null unless JARVIS_PAPERCLIP_ENABLED=1, and requires JARVIS_PAPERCLIP_URL (HTTPS, or loopback HTTP) and JARVIS_PAPERCLIP_COMPANY_ID; JARVIS_PAPERCLIP_TOKEN is an optional agent API key. PaperclipGovernanceMirror maps queued to todo, succeeded to done, failed/blocked/timed_out to blocked and cancelled to cancelled. Active phases become comments because Paperclip requires checkout for in_progress. A rejected 422 transition degrades to a comment, and mirror failures are returned, never thrown into the kernel.
- kernel/adapters/autheo.js (v1 = autheo-agent-environment SPEC-SIGNATURES at 68bfb55): verifyToken follows spec §1.4 (EdDSA only, typ autheo-<kind>+jwt for passport/mandate/request/receipt/handoff/trust-snapshot/outcome, expected kid, no crit, signature over the received bytes, required integer claims, iss/aud string equality, exp unless historical receipt, 2 s skew, nbf==iat, MAX_TTL, body schema). Errors carry `code` and the spec class `spec` (bad_format/bad_header/bad_signature/bad_claims/expired/not_yet_valid). Keys can be PEM, KeyObject or OKP JWK. verifyAgentDocument enforces the agent kid = sha256:base64url(SHA-256(SPKI DER)), with legacy demo-v1 accepted. verifyReceiptArchive ({receipts:[jws]}) and verifyReceiptChain (ledger-entry rows, non-throwing, firstInvalidSequence) check sequence, previous_hash, chain_hash, unique request ids, executed:false and known kinds. Body checking defaults to auto: bodies with schema_version must match the vendored v1 schemas, and bodies without it get the 0.1 (8106edd) rules and are reported as legacy-0.1. allowLegacy:false refuses legacy bodies. canonicalJson implements autheo-cjson/1. signAgentDocument signs request/outcome documents. AutheoReceiptLedger emits schema-validated v1 bodies (schema_version, recorded_at, action tool.invoke, tool jarvis:<operation>, resource workspace:<ws>), or 0.1 bodies with format:'legacy-0.1'. recordOutcome emits outcome_report/recorded. trustOutcomeObserver records outcomes for terminal tasks. Optional verifyWithPythonCli (JARVIS_AUTHEO_PYTHON, JARVIS_AUTHEO_PYTHONPATH; passes --kid for non-legacy kids).
- kernel/adapters/autheo-schema.js: minimal draft 2020-12 validator for the keywords the vendored schemas use. An unknown keyword fails at load, so a schema change cannot be half-checked.
- kernel/adapters/autheo-client.js: createAutheoClient for the 0.2 loopback API (/v1/health, info, policy, schemas, identities, mandates, evaluate, receipts/outcome, receipts/verify, ledger/verify, ledger/receipts, checkpoints, handoffs/accept). It only allows loopback http, sends a Bearer token, uses redirect:'error', a timeout and a 1 MiB response cap. Errors fail closed (autheo_unreachable/timeout/auth/http/response). Receipts are verified against a pinned trust anchor when one is configured, and pinAnchorFromInfo refuses a mismatch. evaluateAction signs an autheo-request+jwt and returns allow only for a non-replayed allow. reportOutcome signs an autheo-outcome+jwt.
- kernel/startup.js adaptersFromEnv: JARVIS_AUTHEO_ENABLED=1 (+ _ENVIRONMENT, _ISSUER, _PRIVATE_KEY_FILE, _KID, _FORMAT=v1|legacy-0.1, _OUTCOMES=0); JARVIS_AUTHEO_API_ENABLED=1 (+ _API_URL default http://127.0.0.1:8780, _API_TOKEN or _API_TOKEN_FILE, _ANCHOR_PUBLIC_KEY_FILE/_ANCHOR_KID/_ANCHOR_ISSUER, _API_TIMEOUT_MS); JARVIS_PAPERCLIP_ENABLED=1 (+ _URL, _COMPANY_ID, _TOKEN, _TIMEOUT_MS, _ASSIGNEE_AGENT_ID, _PROJECT_ID, _GOAL_ID). kernel/http.js uses it at CLI startup, logs a secret-free summary, reports adapter booleans in /api/health and serves GET /api/trust (anchor, head, count, fresh local verification, Paperclip mirror status).
- Kernel hooks: new Kernel({trust, observers}). trust.recordGovernance runs after a new admission (allow) and on scope/capability denial (block). Its receipt summary is persisted as task.trust with a trust-receipt event. Observers receive a cloned task on admission, cancellation and terminal state. Neither can admit, schedule or veto work, and a hook failure never fails the task.

- kernel/adapters/dada.js (DADA design skill, pinned in upstreams/lock.json; procedure in docs/UPSTREAMS.md): extractDadaContract/readDadaCheckout derive a JSON contract from a fetched checkout (skill name, required paths, discovery link, five artifacts, two modes, S1-S5, no-move-quota rule, graph subgraphs/critic ids, measure.py presets/flags, file hashes). diffDadaContract separates breaking changes (anything JARVIS relies on removed) from informational ones. loadDada refuses a missing checkout (dada_missing), a commit other than the pin (dada_pin) or a broken contract (dada_contract). designPacket builds a jarvis.design-packet/1 (brief, Autonomous/Adaptive with reason, required seats, artifacts, stop conditions, pinned skill sha256); checkDesignLog checks a returned DESIGN-LOG.md structurally (it cannot judge the design or prove the panel was independent). JARVIS_DADA_ENABLED=1 (+ optional JARVIS_DADA_DIR) registers the design.dada executor through new Kernel({executors}); the operation also needs the design.dada capability on the actor. GET /api/upstreams lists the pins and the DADA adapter summary (no network).

Wired into kernel/http.js CLI startup through the env flags above; every flag is off by default. The Autheo API client is constructed and reported, but the kernel does not yet call /v1/evaluate before effects. The receipt ledger is in-memory, so receipts and an ephemeral key are lost on restart. Use JARVIS_AUTHEO_PRIVATE_KEY_FILE for a stable trust anchor. A live Paperclip run is still pending (see PLAN gates).
