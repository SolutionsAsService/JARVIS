> **Implementation checkpoint — October 7, 2026:** Phase 1a now has a real consolidated local task kernel in `kernel/`, persistent SQLite tasks/events, one execution supervisor, bounded workflow/context routing, scoped authenticated HTTP and an opt-in frontend. This is not a full LLM agent runtime or complete merger. See [kernel implementation](docs/KERNEL.md). Earlier claims that no backend exists are superseded by this checkpoint.

# JARVIS

**One ubiquitous intelligent assistant — through codebase unification.** A SolutionsAsService project planning a single JARVIS monorepo/kernel that consolidates reusable OpenClaw and Freddie services, gm workflow policy, Paperclip governance, model routing and first-class MCP capabilities. The current release includes the Phase 0 frontend and a real Phase 1a bounded local kernel; the complete LLM agent-core/governance consolidation remains in progress.

## What ships today

A deployable, responsive **frontend foundation**, not a completed assistant backend:

- Six working views: overview, stack planner, sample skill registry, local task lab, architecture blueprint and workspace settings.
- Capability overlap detection and reversible canonical-skill selection.
- Explicit MCP installation proposals and portable JSON plan export; **no software is installed**.
- A locally executable task state machine demonstrating terminal completion, bounded retries and action-time deadline checks. **No agents or subprocesses execute in the task lab.**
- Local browser persistence, keyboard-accessible dialogs, empty/error states and responsive layouts.
- Tests, CI, a static production build, and an actionable [implementation plan](docs/PLAN.md).

The registry is seeded sample data, not an inventory of installed skills. All engine connections and DevHub integration are clearly marked planned. The UI does not resolve server-side execution issues by itself.

## Run

Node **24.15+** (Node 24 LTS).

    npm ci
    npm run dev

Open the local URL printed by Vite. Build: npm run build. Serve output: npm run preview. Deploy the contents of **dist/**, not the source directory. Hash-based navigation and relative assets support a static host and subpaths.

[Deployment / Shadw](docs/DEPLOYMENT.md) · [Codebase unification plan](docs/PLAN.md) · [Proposed context/kernel contracts](docs/CONTRACTS.md) · [Pinned primary-source evidence](docs/SOURCES.md)

## Verify

    npm test
    npm run build
    # On a host where browser execution is permitted:
    npx playwright install chromium
    npm run test:browser

E2E tests exercise desktop/mobile navigation, duplicate resolution, persistence, plan export and task completion. Running a build alone is not browser verification. Actual validation evidence belongs in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Safety and privacy

No model keys, GitHub tokens, MCP secrets or Gateway credentials belong in this frontend. Settings are descriptive and are not contacted. Browser storage contains sample task titles and nonsecret configuration; avoid entering private work in a publicly shared browser. Exported plans contain no credentials. No telemetry. Google Fonts is the only external UI asset request; system fonts provide a fallback.

The static preview does not scan/delete installed skills, run commands or modify Gateway configuration. The separately started local kernel exposes authenticated scoped APIs and executes bounded text hashing; its real MCP fixture runs only through explicitly configured programmatic tests, not automatic installation. External integrations require explicit authorization, and backend validation never trusts client-side checks.

## Existing solutions and boundaries

The end-state is **consolidated reusable code and in-process services**, not a permanent control plane over independent assistant runtimes. Proposed canonical owner: JARVIS kernel scheduler/execution supervisor, initially using an OpenClaw-derived reusable agent core. Select Freddie service/provider primitives without booting its second agent loop; extract Paperclip goals/work queues/approvals/cost governance without its parallel heartbeat dispatcher. gm remains bounded workflow policy. Compatibility shells are temporary migration aids, not the product.

Model routing (agentic-router-derived candidate) is distinct from capability-aware skill routing. Proposed JARVIS Context Protocol (JCP draft 0.1) is a tentative internal contract, **not an existing standard or replacement for MCP**. MCP servers retain their standard protocols and gain first-class catalog, auth, permissions, lifecycle and approval-backed installation planning. No automatic installation is assumed.

**Implementation underway:** the repository now contains one local task kernel and an actual OpenClaw policy-code extraction. Full agent loops, Freddie services, Paperclip domain/accounting migration and external MCP installation remain future gates. No host runtime/service/config installation was performed. DevHub and public backend deployment contracts remain unknown; static sample views remain disconnected unless local kernel mode is explicitly enabled.

No upstream engines or skills are vendored or relicensed in this first release. Their names, copyright and trademarks remain their owners’ property. Original JARVIS code is MIT; future imported modules retain their own licenses/notices. In particular, the inspected agentic-router source is **Elastic License 2.0, not MIT**; code/artifact reuse and hosted deployment require a separate license decision. See the source matrix and incremental acceptance gates before implementation.
