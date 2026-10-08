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
