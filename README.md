# JARVIS

**One home for an intelligent assistant stack.** A SolutionsAsService project unifying OpenClaw orchestration, gm workflow policy, optional Freddie execution, MCP tools and a capability-aware skill registry.

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

[Deployment / Shadw](docs/DEPLOYMENT.md) · [Architecture and delivery plan](docs/PLAN.md) · [Integration contracts](docs/CONTRACTS.md)

## Verify

    npm test
    npm run build
    # On a host where browser execution is permitted:
    npx playwright install chromium
    npm run test:browser

E2E tests exercise desktop/mobile navigation, duplicate resolution, persistence, plan export and task completion. Running a build alone is not browser verification. Actual validation evidence belongs in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Safety and privacy

No model keys, GitHub tokens, MCP secrets or Gateway credentials belong in this frontend. Settings are descriptive and are not contacted. Browser storage contains sample task titles and nonsecret configuration; avoid entering private work in a publicly shared browser. Exported plans contain no credentials. No telemetry. Google Fonts is the only external UI asset request; system fonts provide a fallback.

The prototype does not scan/delete installed skills, run commands, modify Gateway configuration, launch daemons or expose a backend. Future integrations require explicit authentication, permission checks and safe backend execution. Backend validation must never trust client-side checks.

## Existing solutions and boundaries

Reuse OpenClaw for durable orchestration rather than replacing it. Keep gm as a workflow, not a nested orchestrator. Use Freddie through a pinned adapter rather than booting another task owner. MCP is a tool transport, not an installer permission bypass. The existing gmfreddie combination is relevant upstream precedent, but does not itself supply the unified registry, contracts and lifecycle boundaries planned here. See the plan for source references and integration gates.

No upstream engines or skills are vendored or relicensed in this first release. Their names and trademarks belong to their respective owners. JARVIS code: MIT, SolutionsAsService.
