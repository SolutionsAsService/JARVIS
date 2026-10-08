# Planning source matrix and evidence limits

Inspected 2026-10-07 for planning only. Repository pins resolved from GitHub default-branch commit API, then files fetched by immutable SHA. These are observed revisions at inspection, not a claim of the latest revision forever. Source/doc inspection is **not** executed integration, security validation or verified benchmark evidence. No upstream implementation is copied into JARVIS.

## Primary-source matrix

| Ref | Repository / local artifact | Exact revision | Inspected evidence paths | Supported finding / boundary |
| --- | --- | --- | --- | --- |
| P | https://github.com/paperclipai/paperclip | 5717523b9ea7a2d76efbd6eb73414de9c06c6f96 | README.md; docs/start/architecture.md; LICENSE; server/src/services/heartbeat.ts (targeted ownership/dispatch imports); server/src/services/budgets.ts; server/src/services/budget-reservations.ts; packages/db/src/schema/budget_policies.ts; packages/db/src/schema/heartbeat_runs.ts | README describes agent teams/business governance, goals, tasks and costs. Architecture documents company-scoped control plane, PostgreSQL/Drizzle and single-assignee checkout. Current code has heartbeat/native/legacy ownership and company-transaction budget reservations; extraction cannot assume a scheduler-free module or SQLite portability. |
| R | https://github.com/SolutionsAsService/agentic-router | c3955be90890a2d7e9523c6458ab56c08d94661e | README.md; LICENSE; go.mod; internal/router/router.go; internal/router/strategy.go; internal/router/policy/contract.go; internal/router/policy/resolver.go; internal/router/catalog/catalog.go; internal/router/cluster/scorer_test.go (fixture/fake-embedder excerpt); docs/POLICY_ROUTER_HARNESS.md | This fork contains Weave-branded Go model/API routing, not JARVIS skill routing. Request types carry model/provider/translation eligibility; cluster default plus opt-in strategies; policy harness separates inference from dispatch and says no hidden strategy fallback. Tests inspected use fake embedder/fixtures; not an independent quality/cost/latency benchmark. Root license is ELv2, not MIT. |
| G | https://github.com/SolutionsAsService/gm | d3099593736e725266e6fad07ff02df8d2e882ae | README.md; LICENSE; package.json; skills/gm/SKILL.md | Fork default is lightweight bounded workflow, preserves dirty work/tests, publication only by authorization, no mandatory runtime/recursive continuation. Optional legacy runtime remains separate. No guarantee of model compliance or measured speedup. |
| F | https://github.com/SolutionsAsService/freddie | 5b300a13499fb74db55ec5aedfc3989a24fb29a8 | README.md; LICENSE; docs/architecture.md; docs/subsystems/skills.md; docs/subsystems/subprocess.md; docs/subsystems/web-server.md; packages/subprocess/subprocess/src/types.js; packages/subprocess/subprocess-local/src/index.js | Developer preview; Cordis plugin/service/effect composition. Distinct durable session and live agent events; reconstructable model context; subprocess service/provider has explicit handle/teardown seam. HTTP carrier documentation explicitly says no TLS/auth/origin policy. Candidate extractable services, not proof of interoperability. |
| O | https://github.com/openclaw/openclaw ; installed OpenClaw package | installed version 2026.9.8; **Git commit not supplied in package metadata**; exact local documentation hashes below | package.json; LICENSE; docs/agent-runtime-architecture.md; docs/gateway/protocol/rpc-session-control.md; docs/gateway/background-process.md; docs/tools/skills.md; docs/tools/mcp.md | Installed docs identify reusable packages/agent-core, runtime/LLM boundaries, scoped skills, exact session/run/cursor ownership and MCP catalogs/policy. Native process handles do not establish durable task ownership across restart; task cancel alone does not prove background cleanup. Package version plus hashed docs is a local evidence pin, not an invented upstream Git SHA. Source extraction requires a separate source pin/API proof. |

Primary file links can be reconstructed as https://github.com/<owner>/<repo>/blob/<revision>/<path>. Documentation may lag source: Paperclip architecture's short built-in adapter list is not treated as exhaustive at this large current revision. Only selected heartbeat imports/comments were inspected; no full audit of its roughly 1.24 MB service file is claimed.

## OpenClaw exact local evidence pin

Root: /home/openclaw/.openclaw/tools/node-v24.19.0/lib/node_modules/openclaw . SHA-256:

- docs/agent-runtime-architecture.md: 21f28739e727ce4d6b84ab50ba941111c0b97a2bf8e82df610a69de67012e9b3
- docs/gateway/protocol/rpc-session-control.md: 72ae807a15d57fd2061e607d472107238c08d45e26063572afc0e81a9442a1b9
- docs/gateway/background-process.md: 89292b0c1681870a21774f302cc00a56a41ca330d3de14cff4f379f8a4e820d1
- docs/tools/skills.md: 885caf108b22097db469ed3263542e8546cfeafcd8a6e41f5e5bd32e55fe92fd
- docs/tools/mcp.md: c8c41584e758a2deccbdf3d97bf2cabab248c8cd3b9c668950d543f8536d9a96
- LICENSE: 73571b25326281d369087f469842c02444fe39faaecebda4d82ed21ff3a1c29d

Local installed tools/mcp.md describes stdio/Streamable HTTP/SSE, OAuth, tool filtering, scoped policy, connection/request timeouts, requester-scoped backoff and live probes. Its exact hash is recorded above, rather than assuming a universal upstream release matches this package. During implementation pin the actual negotiated MCP specification/version and transport/auth contract; this plan does not select an unverified latest specification revision. Primary specification entrypoint: https://modelcontextprotocol.io/specification .

## License and ownership disposition — not legal clearance

- **Paperclip:** MIT, copyright (c) 2025 Paperclip AI. Preserve license/notice and inspect per-file/transitive licenses before extraction.
- **OpenClaw installed artifact:** MIT, copyright (c) 2026 OpenClaw Foundation; LICENSE references THIRD_PARTY_NOTICES.md. Installed docs alone do not inventory all extractable source licenses.
- **Freddie:** MIT, copyright (c) 2026 DeepSeek; README points to THIRD_PARTY_NOTICES.md. Cordis/native/transitive dependencies and individual package licenses need inventory.
- **gm:** MIT, copyright (c) 2026 AnEntrypoint. Preserve fork credit: Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService . Lightweight default differs from inherited optional runtime licensing/dependency footprint.
- **agentic-router:** Elastic License 2.0, copyright 2025 Workweave, Inc. GitHub metadata reports NOASSERTION/Other; actual LICENSE controls the planning finding. Text restricts third-party hosted/managed services exposing a substantial feature set, license-key circumvention and notice removal; requires terms with distributed portions and prominent modification notices. Do not assume SolutionsAsService fork ownership grants new licensing rights. Deployment/reuse review is a gate; no legal compatibility decision is claimed here. Check model/embedding/artifact licenses separately.

JARVIS MIT covers original JARVIS work, not unilateral relicensing of imported code. Future extraction manifest must carry upstream SHA/path/hash, original author/license, adaptation history, responsible maintainer and test evidence. No permission is inferred from a repository being publicly readable.

## Advertised versus verified

Paperclip README's autonomous-team/business and feature descriptions are upstream product claims; inspected governance/budget/schema paths provide narrower implementation evidence, not proof an autonomous business succeeds. Router README's always-right/best-model phrasing, badges and derived algorithm attribution are advertising, not an independently measured guarantee. gm explicitly disclaims speedup/behavior guarantees. Freddie developer-preview docs describe contracts, not stable cross-product compatibility.

**No upstream benchmarks or integration suites were executed in this planning task.** Required future evaluation: immutable dataset/tasks, baseline model routes, provider/pricing/time/hardware revisions, license-permitted artifacts, quality/cost and p50/p95 latency, failure/cancellation/permission cases and reproducible raw receipts. Mock scorer/fixture presence is not substituted for results. Proposed JARVIS routers/context/scheduler remain unimplemented.

## Inspection receipt and reproducibility

GitHub API metadata/tree and pinned raw source copies were saved only to temporary /tmp/jarvis-planning-evidence-20261007/<owner>__<repo>/ for this bounded review. Each index.json records repository, branch and SHA; evidence file paths match the matrix. Temporary copies are not vendored JARVIS dependencies and may expire. Use pinned GitHub paths to reproduce the inspection; do not rely on /tmp as durable provenance storage.

JARVIS baseline at start: 7b34f17c67bd5253f3659d773475f7de38a65a0d; status output contained no dirty entries. No repository-local AGENTS.md found under JARVIS; workspace instructions and installed gm bounded workflow governed this docs-only task. Historical PLAN cited gmfreddie as integration precedent; it is not reverified or selected as a canonical unified runtime in this revision.
