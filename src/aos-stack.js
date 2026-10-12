// AOS (agent operating stack) catalog: one source of truth for the stack view, the kernel catalog
// export and the schema test. Status vocabulary is deliberately small and honest:
//   integrated = code that runs inside JARVIS today (tests exercise it)
//   adapter    = JARVIS code that talks to/verifies an external system; OFF by default, the external
//                system is NOT bundled and must be run separately
//   planned    = not connected; a candidate or a design target only
// Licenses are as reported by the upstream LICENSE file/GitHub on 2026-10-12, not legal advice.
export const statuses = Object.freeze({
  integrated: {label: 'Integrated', description: 'Runs inside JARVIS today and is covered by tests.'},
  adapter: {label: 'Adapter', description: 'JARVIS adapter code exists; the external system runs separately and the connector is off by default.'},
  planned: {label: 'Planned', description: 'Not connected. Candidate or design target only.'},
});

export const layers = Object.freeze([
  {id: 'interface', name: 'Interface', summary: 'Where people and other systems reach JARVIS.'},
  {id: 'kernel', name: 'Kernel & routing', summary: 'One scheduler, one execution owner, skill/model routing and context.'},
  {id: 'agents', name: 'Agents & runtimes', summary: 'Agent loops, workflow policy and agent-company runtimes.'},
  {id: 'governance', name: 'Governance & trust', summary: 'Who may do what, under which budget, with which receipt.'},
  {id: 'tools', name: 'Tools & MCP', summary: 'Capabilities reached through the Model Context Protocol.'},
  {id: 'models', name: 'Models', summary: 'Inference providers and model routers.'},
  {id: 'infra', name: 'Infrastructure & deploy', summary: 'Where it runs, how it ships and how it is observed.'},
]);

export const categories = Object.freeze(['interface', 'kernel', 'router', 'memory', 'runtime', 'workflow', 'governance', 'trust', 'mcp', 'model', 'observability', 'deploy']);

const c = (o) => Object.freeze({jarvisPaths: [], real: [], planned: [], links: [], ...o});

export const components = Object.freeze([
  // Interface
  c({id: 'jarvis-web', name: 'JARVIS web workspace', layer: 'interface', category: 'interface', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'This site. A static Vite build with sample registry and simulated Task Lab; the live kernel panel is opt-in on loopback only.',
    real: ['AOS stack map, planner, sample registry, simulated task lab', 'Opt-in ?kernel=local panel calling the authenticated kernel API'], planned: ['Shared identity across chat/device surfaces'],
    jarvisPaths: ['src/main.js', 'src/kernel-client.js'], links: ['jarvis-api']}),
  c({id: 'jarvis-api', name: 'Kernel HTTP API', layer: 'interface', category: 'interface', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Bearer-token, loopback-only, same-origin JSON API. Not a public or multi-tenant service.',
    real: ['/api/tasks submit/read/cancel', '/api/skills/route, /api/models/route, /api/mcp/preview'], planned: ['Hosted auth/TLS', 'DevHub ingress'],
    jarvisPaths: ['kernel/http.js'], links: ['jarvis-kernel']}),
  c({id: 'openclaw-surfaces', name: 'OpenClaw channels & Control UI', layer: 'interface', category: 'interface', status: 'planned', repo: 'https://github.com/openclaw/openclaw', license: 'MIT', owner: 'OpenClaw Foundation',
    note: 'Chat/device surfaces exist upstream. JARVIS does not connect to an OpenClaw Gateway.',
    planned: ['Normalize chat/device sessions onto kernel tasks'], links: ['jarvis-api']}),

  // Kernel & routing
  c({id: 'jarvis-kernel', name: 'JARVIS kernel (scheduler + supervisor)', layer: 'kernel', category: 'kernel', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'SQLite task/event custody, idempotency, leases, deadlines, cancellation and restart reconciliation. Executes bounded text hashing and an owned MCP fixture only; no LLM loop.',
    real: ['Durable tasks/events (node:sqlite)', 'Single-owner supervisor with lease epochs', 'Optional trust and observer hooks'], planned: ['Embedded agent loop', 'Multi-host scheduling'],
    jarvisPaths: ['kernel/kernel.js', 'kernel/store.js'], links: ['skill-router', 'jarvis-governance', 'jcp-context', 'model-router', 'mcp-sdk', 'event-ledger']}),
  c({id: 'skill-router', name: 'Skill router', layer: 'kernel', category: 'router', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Deterministic capability/permission/license/platform filtering with dependency closure and token budget. Heuristic scoring, not semantic inference.',
    real: ['Selected/rejected reasons, dedupe, conflicts, budget'], planned: ['Labeled evaluation set'], jarvisPaths: ['kernel/skill-router.js'], links: ['bounded-work']}),
  c({id: 'model-router', name: 'Model router (baseline)', layer: 'kernel', category: 'router', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Independently authored eligibility + lowest-declared-price decision. Zero providers are configured, so every route is explicitly blocked; no inference happens.',
    real: ['Eligibility filters before ranking, explicit pin without hidden fallback'], planned: ['Configured providers', 'agentic-router-derived policy'], jarvisPaths: ['kernel/model-router.js'], links: ['agentic-router', 'provider-apis', 'ollama']}),
  c({id: 'jcp-context', name: 'JCP context manifests', layer: 'kernel', category: 'memory', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'JARVIS Context Protocol draft 0.1: scoped, hashed, provenance-carrying context manifests. An internal draft, not a standard and not an MCP replacement.',
    real: ['Trust-role separation, mandatory items, chars/4 budget'], planned: ['Retention/redaction', 'Long-term memory store'], jarvisPaths: ['kernel/context.js', 'docs/CONTRACTS.md'], links: ['openclaw-memory', 'mem0', 'letta']}),
  c({id: 'openclaw-memory', name: 'OpenClaw memory (files + search)', layer: 'kernel', category: 'memory', status: 'planned', repo: 'https://github.com/openclaw/openclaw', license: 'MIT', owner: 'OpenClaw Foundation',
    note: 'Upstream workspace memory files and memory search. Not read by JARVIS.', planned: ['Import as provenance-labelled JCP evidence']}),
  c({id: 'mem0', name: 'Mem0', layer: 'kernel', category: 'memory', status: 'planned', repo: 'https://github.com/mem0ai/mem0', license: 'Apache-2.0', owner: 'Mem0',
    note: 'Candidate long-term memory layer. Not evaluated, installed or connected.', planned: ['Evaluate against tenant isolation and retention rules']}),
  c({id: 'letta', name: 'Letta', layer: 'kernel', category: 'memory', status: 'planned', repo: 'https://github.com/letta-ai/letta', license: 'Apache-2.0', owner: 'Letta',
    note: 'Candidate stateful-agent memory server. Not evaluated, installed or connected.', planned: ['Compare with Mem0 before choosing one']}),

  // Agents & runtimes
  c({id: 'openclaw-runtime', name: 'OpenClaw agent runtime', layer: 'agents', category: 'runtime', status: 'planned', repo: 'https://github.com/openclaw/openclaw', license: 'MIT', owner: 'OpenClaw Foundation',
    note: 'Proposed initial embedded agent core. Only the glob/regexp policy matcher has been extracted so far (see governance layer).', planned: ['Extract reusable agent-core package behind kernel ownership'], links: ['jarvis-kernel']}),
  c({id: 'freddie', name: 'Freddie', layer: 'agents', category: 'runtime', status: 'planned', repo: 'https://github.com/SolutionsAsService/freddie', license: 'MIT', owner: 'DeepSeek (upstream) / SolutionsAsService fork',
    note: 'Developer-preview Cordis service/provider framework. Inspected; its subprocess service depends on node-pty and its runtime, so nothing was extracted.', planned: ['Selective service/provider extraction without its agent loop']}),
  c({id: 'paperclip', name: 'Paperclip', layer: 'agents', category: 'runtime', status: 'adapter', repo: 'https://github.com/paperclipai/paperclip', license: 'MIT', owner: 'Paperclip AI (upstream) / SolutionsAsService fork',
    note: 'Agent-company control plane (companies, agents, issues, approvals, budgets, heartbeats). JARVIS ships an HTTP governance adapter: it mirrors kernel tasks into Paperclip issues and reads agents, approvals and heartbeat runs. Off by default (needs JARVIS_PAPERCLIP_ENABLED=1); the Paperclip server is not bundled.',
    real: ['REST client for /api/health, companies, agents, issues, comments, approvals, heartbeat-runs', 'One-way task to issue mirror (mock-server tested)', 'Heartbeat invoke refused unless explicitly allowed per call'],
    planned: ['Live run against a real Paperclip instance', 'Goal/project mapping tables', 'Extract budget/approval domain logic'], jarvisPaths: ['kernel/adapters/paperclip.js'], links: ['jarvis-governance', 'jarvis-kernel']}),
  c({id: 'bounded-work', name: 'JARVIS bounded-work policy', layer: 'agents', category: 'workflow', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Independently authored gm-style inspect/change/verify/finish policy routed into every admitted task. Not a copy of gm.', real: ['Pinned workflow policy in each task context manifest'], jarvisPaths: ['kernel/catalog.js'], links: ['gm']}),
  c({id: 'gm', name: 'gm', layer: 'agents', category: 'workflow', status: 'planned', repo: 'https://github.com/SolutionsAsService/gm-lite', license: 'MIT', owner: 'AnEntrypoint (upstream) / SolutionsAsService fork',
    note: 'Bounded engineering workflow skill (SolutionsAsService/gm now redirects to gm-lite; upstream https://github.com/AnEntrypoint/gm). Policy reference for JARVIS; not vendored or run by the kernel.', planned: ['Import as an approved skill revision with attribution']}),
  c({id: 'agentplug', name: 'agentplug', layer: 'agents', category: 'workflow', status: 'planned', repo: 'https://github.com/AnEntrypoint/agentplug', license: 'No license detected', owner: 'AnEntrypoint',
    note: 'WASM plugin-routing runtime (one native runner hosting gm, libsql, bert, tree-sitter modules). No license file detected on GitHub, so reuse is not cleared.', planned: ['License clarification before any evaluation']}),

  // Governance & trust
  c({id: 'jarvis-governance', name: 'JARVIS governance', layer: 'governance', category: 'governance', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Scoped work-approval receipts and integer admission budgets. Paperclip-inspired, independently authored; no provider billing.', real: ['Hash-identified approval receipt per task', 'Admission budget (100 open tasks per tenant)'], planned: ['Human approval workflow', 'Cost ledger'],
    jarvisPaths: ['kernel/governance.js'], links: ['autheo-env', 'openclaw-policy', 'paperclip']}),
  c({id: 'openclaw-policy', name: 'OpenClaw policy matcher (extracted)', layer: 'governance', category: 'governance', status: 'integrated', repo: 'https://github.com/openclaw/openclaw', license: 'MIT', owner: 'OpenClaw Foundation',
    note: 'Two upstream files extracted unchanged at a pinned commit with hashes and notice; used for capability allow/deny decisions.', real: ['Glob capability authorization (deny wins)'], jarvisPaths: ['kernel/vendor/openclaw/']}),
  c({id: 'autheo-env', name: 'Autheo Agent Environment', layer: 'governance', category: 'trust', status: 'adapter', repo: 'https://github.com/SolutionsAsService/autheo-agent-environment', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Local reference prototype for agent passports, scoped mandates, allow/escalate/block decisions and Ed25519-signed, hash-chained receipts. JARVIS maps its governance outcomes to that vocabulary, signs receipts in the same format and verifies archives in JS; the Python CLI bridge is optional and off by default. Simulation only: nothing here proves a real-world action.',
    real: ['JS verifier for autheo-receipt+jwt archives (tested on receipts produced by the Python demo)', 'JS receipt ledger whose archives the Python audit CLI verifies', 'Kernel trust hook (off by default)'],
    planned: ['Real DID/identity authority', 'Mandates issued by an isolated signer', 'Autheo chain anchoring'], jarvisPaths: ['kernel/adapters/autheo.js'], links: ['autheo-mcp']}),

  // Tools & MCP
  c({id: 'mcp-sdk', name: 'MCP TypeScript SDK', layer: 'tools', category: 'mcp', status: 'integrated', repo: 'https://github.com/modelcontextprotocol/typescript-sdk', license: 'MIT / Apache-2.0 (transition)', owner: 'Model Context Protocol project',
    note: 'Pinned @modelcontextprotocol/sdk 1.32.1 drives a real stdio client lifecycle (initialize, list, schema-hash grant, call, cleanup).', real: ['stdio client with deadlines and cleanup evidence'], planned: ['Streamable HTTP + OAuth'], jarvisPaths: ['kernel/mcp.js'], links: ['fixture-mcp', 'autheo-mcp', 'gm-mcp', 'mcp-filesystem', 'github-mcp']}),
  c({id: 'fixture-mcp', name: 'JARVIS owned fixture MCP', layer: 'tools', category: 'mcp', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'A deterministic echo server owned by the kernel, used to prove the MCP lifecycle. Not an external tool.', real: ['Code-hash pinned stdio child process'], jarvisPaths: ['kernel/fixture-mcp.js']}),
  c({id: 'autheo-mcp', name: 'Autheo MCP', layer: 'tools', category: 'mcp', status: 'planned', repo: 'https://github.com/autheo-os/autheo-MCP', license: 'No license detected', owner: 'Autheo (ThothDivision/autheo-mcp redirects here)',
    note: 'MCP server for Autheo blockchain, marketplace and developer tooling, with read-only agent-trust inspection tools fed by autheo-agent-environment exports. Not installed or connected by JARVIS.', planned: ['Install proposal with pinned revision and read-only scopes']}),
  c({id: 'gm-mcp', name: 'gm-mcp', layer: 'tools', category: 'mcp', status: 'planned', repo: 'https://github.com/SolutionsAsService/gm-mcp', license: 'No license detected', owner: 'SolutionsAsService fork',
    note: 'MCP server exposing gm spool dispatch (write, poll, cleaned response). Would add a second dispatcher, so it stays planned behind kernel ownership rules.', planned: ['Evaluate only as a kernel-owned capability']}),
  c({id: 'mcp-filesystem', name: 'MCP filesystem server', layer: 'tools', category: 'mcp', status: 'planned', repo: 'https://github.com/modelcontextprotocol/servers', license: 'MIT / Apache-2.0 (transition)', owner: 'Model Context Protocol project',
    note: 'Reference server (src/filesystem) for workspace-scoped file access. Appears in the planner as a proposal only.', planned: ['Project-scoped install proposal, explicit roots']}),
  c({id: 'github-mcp', name: 'GitHub MCP server', layer: 'tools', category: 'mcp', status: 'planned', repo: 'https://github.com/github/github-mcp-server', license: 'MIT', owner: 'GitHub',
    note: 'Official GitHub MCP server. Proposal only; no token is configured.', planned: ['Read-only repository scope first']}),

  // Models
  c({id: 'agentic-router', name: 'agentic-router', layer: 'models', category: 'router', status: 'planned', repo: 'https://github.com/SolutionsAsService/agentic-router', license: 'Apache-2.0 (current main; ELv2 at the earlier pinned revision)', owner: 'Workweave (upstream) / SolutionsAsService fork',
    note: 'Go model-routing service. Upstream moved from ELv2 to Apache-2.0 after the October 7 inspection pin; no code is used and reuse must follow the license of the exact revision.', planned: ['Re-evaluate the policy harness under Apache-2.0']}),
  c({id: 'litellm', name: 'LiteLLM', layer: 'models', category: 'router', status: 'planned', repo: 'https://github.com/BerriAI/litellm', license: 'MIT (outside enterprise/)', owner: 'BerriAI',
    note: 'Candidate provider gateway. Not installed; enterprise/ directory is separately licensed.', planned: ['Compare with an in-process provider layer']}),
  c({id: 'provider-apis', name: 'Hosted model APIs', layer: 'models', category: 'model', status: 'planned', repo: 'https://docs.anthropic.com/', license: 'Proprietary service terms', owner: 'Anthropic, OpenAI and others',
    note: 'No provider credentials exist in JARVIS; the model router therefore returns blocked. Paid inference needs explicit approval.', planned: ['Backend-only scoped secret references']}),
  c({id: 'ollama', name: 'Ollama', layer: 'models', category: 'model', status: 'planned', repo: 'https://github.com/ollama/ollama', license: 'MIT', owner: 'Ollama',
    note: 'Candidate local inference runtime. Not configured.', planned: ['Local provider entry in the model catalog']}),

  // Infrastructure & deploy
  c({id: 'event-ledger', name: 'Task event ledger', layer: 'infra', category: 'observability', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Ordered per-task SQLite events (accepted, claim, lease, phases, terminal, trust-receipt). Local only; no metrics export.', real: ['GET /api/tasks/:id returns ordered events'], jarvisPaths: ['kernel/store.js']}),
  c({id: 'opentelemetry', name: 'OpenTelemetry JS', layer: 'infra', category: 'observability', status: 'planned', repo: 'https://github.com/open-telemetry/opentelemetry-js', license: 'Apache-2.0', owner: 'OpenTelemetry',
    note: 'Candidate tracing/metrics export for kernel spans. Not a dependency.', planned: ['Span per task phase, no payload content']}),
  c({id: 'langfuse', name: 'Langfuse', layer: 'infra', category: 'observability', status: 'planned', repo: 'https://github.com/langfuse/langfuse', license: 'MIT (core; ee/ separately licensed)', owner: 'Langfuse',
    note: 'Candidate LLM trace/eval store once real inference exists. Not connected.', planned: ['Only after a model provider is approved']}),
  c({id: 'github-actions', name: 'GitHub Actions CI', layer: 'infra', category: 'deploy', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS/actions', license: 'Service', owner: 'GitHub',
    note: 'Runs npm test, build and Chromium desktop/mobile E2E on every push to main.', real: ['.github/workflows/ci.yml'], jarvisPaths: ['.github/workflows/ci.yml']}),
  c({id: 'docker-static', name: 'Static container', layer: 'infra', category: 'deploy', status: 'integrated', repo: 'https://github.com/SolutionsAsService/JARVIS', license: 'MIT', owner: 'SolutionsAsService',
    note: 'Non-root Node static server image for dist/. Serves the preview only, never the kernel.', real: ['Dockerfile + tested server.mjs'], jarvisPaths: ['Dockerfile', 'server.mjs']}),
  c({id: 'shadw', name: 'Shadw', layer: 'infra', category: 'deploy', status: 'planned', repo: 'https://www.npmjs.com/package/@shadw/cli', license: 'Unverified', owner: 'Shadw',
    note: 'Intended static hosting target (shadw.cloud). No login, deployment or account configuration has been performed.', planned: ['Deploy dist/ with the platform documented flow']}),
  c({id: 'devhub', name: 'Autheo DevHub', layer: 'infra', category: 'deploy', status: 'planned', repo: 'https://github.com/ThothDivision/L0_devhub_deploy', license: 'Open BSL per repo description (GitHub: NOASSERTION)', owner: 'ThothDivision',
    note: 'Target developer hub / Layer 0 deployment. The task/identity/acknowledgement contract is unknown, so no endpoint is invented.', planned: ['Agree contract, then a real task to verified-result handoff']}),
]);

// Toggleable task paths. Each step names a component and what crosses that edge.
export const flows = Object.freeze([
  {id: 'digest', name: 'Live digest task (runs today)', status: 'integrated', summary: 'What actually happens when you submit a task to the local kernel.',
    steps: [['jarvis-web', 'Opt-in panel sends text + idempotency key'], ['jarvis-api', 'Bearer auth, loopback host, 8 KB body limit'], ['jarvis-kernel', 'Scope + capability check, durable admission'], ['skill-router', 'Pins jarvis.bounded-work policy'], ['jarvis-governance', 'Approval receipt + admission budget'], ['autheo-env', 'Optional: signed allow/block receipt'], ['jcp-context', 'Scoped, hashed context manifest'], ['event-ledger', 'Phases + terminal result persisted'], ['paperclip', 'Optional: issue mirrored for governance view']]},
  {id: 'mcp', name: 'Owned MCP tool call (tested)', status: 'integrated', summary: 'The kernel-owned MCP lifecycle exercised by the test suite.',
    steps: [['jarvis-kernel', 'Task with operation mcp.fixture.echo'], ['jarvis-governance', 'Capability + approval'], ['openclaw-policy', 'Glob allow/deny'], ['mcp-sdk', 'initialize, list tools, schema-hash grant'], ['fixture-mcp', 'Owned stdio child: call + cleanup'], ['event-ledger', 'Cleanup evidence recorded']]},
  {id: 'llm', name: 'Future LLM task (planned)', status: 'planned', summary: 'The target path once an agent core and providers are approved. None of these hops are live.',
    steps: [['openclaw-surfaces', 'Chat/device request'], ['jarvis-kernel', 'Admission + ownership'], ['model-router', 'Eligible provider decision'], ['provider-apis', 'Inference'], ['openclaw-runtime', 'Embedded agent loop'], ['github-mcp', 'Scoped tool calls'], ['autheo-env', 'Mandate + receipt'], ['devhub', 'Verified result handoff']]},
]);

export const componentById = (id) => components.find((x) => x.id === id);
export function stackSummary() {
  const counts = {integrated: 0, adapter: 0, planned: 0};
  for (const x of components) counts[x.status]++;
  return {total: components.length, ...counts, layers: layers.length};
}
