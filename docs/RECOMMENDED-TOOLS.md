# Recommended MCP servers and tools (2026-10-14)

Shortlist of MCP servers worth adding to the AOS stack beyond what JARVIS already tracks
(fixture MCP, gm-mcp, jCodeMunch, unified CAD MCP, and the planned MCP filesystem / GitHub MCP / Autheo MCP entries).
Evidence was read from the official repositories and registries on 2026-10-14 (GitHub API: stars, last push,
latest release, LICENSE; npm / PyPI: latest version and date). Stars and dates are a maintenance signal, not a
security review. A detected licence is a starting point for review, not legal clearance.

How this maps onto JARVIS conventions:

- **Added as an adapter (off by default):** Playwright MCP, see below and [kernel/adapters/playwright-mcp.js](../kernel/adapters/playwright-mcp.js).
- **Added as `planned` catalog entries** in [src/aos-stack.js](../src/aos-stack.js) (shown on the AOS stack site, nothing
  installed, no adapter, no grant): only servers that are clearly maintained **and need no secrets**: MCP git, MCP fetch,
  MCP memory, MCP sequential thinking, Context7 (keyless mode) and Chrome DevTools MCP. Each entry names the exact pinned
  launch command an adapter would use.
- **Everything that needs a token, a paid key or a host service** stays in this document only. Nothing here is enabled.

## Added: Playwright MCP

| | |
|---|---|
| Repo | https://github.com/microsoft/playwright-mcp (npm `@playwright/mcp`) |
| Pin | v0.0.83, commit f183dad4a52965583e3cc1d59b88cdc279e2e57d (release 2026-09-28) in [upstreams/lock.json](../upstreams/lock.json) |
| Maintenance | ~38k stars, pushed 2026-10-08, frequent releases, Microsoft Playwright team |
| Licence | Apache-2.0 |
| Auth | none |
| What it gives | 25 browser tools (navigate, accessibility snapshot, click/type/fill, screenshots, console, network, tabs). Snapshots are structured text, so no vision model is needed. |

Install (operator, not CI): `npm run mcp:playwright:install` installs the pinned package into
`.jarvis/tools/playwright-mcp` (gitignored) and downloads the matching browser build with the package's own
`install-browser chrome-for-testing`. Headless Linux hosts also need libnss3, libnspr4 and libasound2; without root,
`apt-get download libnss3 libnspr4 libasound2t64` + `dpkg -x` into a directory and point `LD_LIBRARY_PATH` at it (passed
through to the child).

Enable: `JARVIS_PLAYWRIGHT_MCP_ENABLED=1 JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS="https://example.com;https://docs.example.com" npm run start:kernel`.
Tasks use operation `mcp.playwright`; the task text is a URL, `{"tool","arguments"}` or `{"steps":[...]}` (up to 10 tool
calls in one isolated browser session). All variables are listed at the top of the adapter.

Security notes. It drives a real browser, and every page it reads is untrusted input that can carry prompt injection.

- The kernel always launches it with `--headless --isolated` (in-memory profile: no cookies, logins or history persist or
  leak in), its own `--output-dir` (default `.jarvis/playwright-mcp/output`, also the child's working directory),
  `--no-webmcp` (pages cannot register tools for the agent), `--image-responses omit` and `--codegen none`.
- An origin allowlist is **required**. The operator must set `JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS` or explicitly opt out with
  `JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS=1`. Upstream says `--allowed-origins` is **not a security boundary** and does not
  cover redirects. It limits accidents, not a hostile page. For real isolation, run the kernel in a container or VM with
  egress filtering.
- It never passes `--allow-unrestricted-file-access`, `--extension` or `--cdp-endpoint` (both attach to your real
  browser), `--user-data-dir` or `--secrets`.
- The default tool grant is read-mostly (navigate, back, snapshot, screenshot, wait, console, network, tabs, close).
  Click/type/fill must be granted explicitly with `JARVIS_PLAYWRIGHT_MCP_TOOLS`. `browser_evaluate`,
  `browser_run_code_unsafe` and `browser_file_upload` are refused unless `JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS=1`.
- The child environment is built from scratch: PATH, HOME, locale, LD_LIBRARY_PATH, PLAYWRIGHT_BROWSERS_PATH and display
  variables only. No JARVIS_* values or tokens are passed.

For a desktop MCP client (not the JARVIS kernel), the equivalent locked-down entry is:

```json
{"mcpServers": {"playwright": {"command": "npx", "args": ["-y", "@playwright/mcp@0.0.83", "--headless", "--isolated",
  "--browser", "chromium", "--output-dir", "/abs/path/playwright-output", "--no-webmcp",
  "--allowed-origins", "https://example.com"]}}}
```

Upstream documents `npx @playwright/mcp@latest`. JARVIS pins the version instead, following its pin-and-verify
convention. To update, bump `runtime.package.version` (and the commit) in upstreams/lock.json, then run
`npm run mcp:playwright:install`.

## Shortlist

Licence key: "MIT → Apache-2.0" means the modelcontextprotocol/servers repository is part-way through relicensing.
New code is Apache-2.0, and older contributions stay MIT until their authors consent.

| Name | Repo | What it gives | Maintenance (2026-10-14) | Licence | Auth needed | Recommended |
|---|---|---|---|---|---|---|
| GitHub MCP server | [github/github-mcp-server](https://github.com/github/github-mcp-server) | Repos, issues, PRs, Actions runs/logs, code-scanning and Dependabot alerts, with toolsets and a read-only mode | 33.6k★, v2.0.2 on 2026-10-08, commits daily | MIT | GitHub PAT (fine-grained, read-only first) or OAuth | **yes**: already a planned catalog entry. Needs a token, so not enabled. Start with `--read-only --toolsets repos,issues,pull_requests,actions` |
| MCP git | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) `src/git` (PyPI `mcp-server-git`) | status/diff/log/show/branch/commit on one local repo | servers repo 91k★, mcp-server-git 2026.10.10 released 2026-10-11 | MIT → Apache-2.0 | none | **yes**: planned entry `mcp-git`. Read-only tools first |
| MCP filesystem | same repo, `src/filesystem` (npm `@modelcontextprotocol/server-filesystem` 1.0.0) | Scoped read/write/search under explicit roots | 1.0.0 published 2026-10-11 | MIT → Apache-2.0 | none | **yes**: already a planned catalog entry |
| MCP fetch | same repo, `src/fetch` (PyPI `mcp-server-fetch`) | URL → markdown, chunked | 2026.10.10 released 2026-10-11 | MIT → Apache-2.0 | none | **yes**: planned entry `mcp-fetch`. It can reach localhost and private ranges (SSRF), so it needs an egress policy before any grant |
| Context7 | [upstash/context7](https://github.com/upstash/context7) (npm `@upstash/context7-mcp`) | Current, version-specific library docs and examples, which cuts down on hallucinated APIs | 63k★, 4.4.1 released 2026-10-13 | MIT | none (keyless at lower rate limit); optional free key | **yes**: planned entry `context7`. Queries go to a hosted index, so never paste private code into them |
| MCP Inspector (dev tool) | [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) | UI/CLI to test any MCP server: tools/list, calls, schemas | 11k★, 2.11.0 released 2026-10-14 | MIT → Apache-2.0 | none | **yes**, for development only (`npx @modelcontextprotocol/inspector@2.11.0 <cmd>`). Not a runtime component |
| MCP memory | same repo, `src/memory` (npm `@modelcontextprotocol/server-memory` 1.0.0) | Local JSONL knowledge graph (entities, relations, observations) | 1.0.0 published 2026-10-11 | MIT → Apache-2.0 | none | maybe: planned entry `mcp-memory`. Overlaps JCP context and OpenClaw memory, so compare before adopting |
| Sequential thinking | same repo, `src/sequentialthinking` | Structured step-by-step reasoning scratchpad with revisions | 1.0.0 published 2026-10-11 | MIT → Apache-2.0 | none | maybe: planned entry. Only useful once JARVIS has an agent loop |
| Chrome DevTools MCP | [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Performance traces, network and console inspection, audits in Chrome | 53.5k★, 1.10.1 released 2026-09-23, commits daily | Apache-2.0 | none | maybe: planned entry. Complements Playwright for debugging and perf. Same lockdown applies (`--headless --isolated`) |
| MCP Toolbox for Databases | [googleapis/mcp-toolbox](https://github.com/googleapis/mcp-toolbox) | One server for Postgres, MySQL, SQLite, BigQuery and others, driven by a tools.yaml of vetted queries | 16.7k★, v1.14.0 released 2026-10-08 | Apache-2.0 | DB credentials (none for a local SQLite file) | maybe: the best maintained DB option. Its predefined-query model fits JARVIS grants |
| Postgres MCP Pro | [crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp) | Postgres with restricted/unrestricted modes, index tuning, health checks | 3.4k★, last release v0.3.0 on 2025-05-16 (commits to 2026-08) | MIT | DATABASE_URI | maybe: useful, but the release cadence is slow. Prefer MCP Toolbox |
| EVM MCP server | [mcpdotdirect/evm-mcp-server](https://github.com/mcpdotdirect/evm-mcp-server) (npm `@mcpdotdirect/evm-mcp-server`) | Read chain state on 60+ EVM networks: blocks, txs, balances, contract reads, multicall, ENS | 378★, v2.0.4 released 2025-11-26, commits to 2026-06 | MIT | none for public-RPC reads; Etherscan key optional for ABIs; `EVM_PRIVATE_KEY`/mnemonic for writes | maybe: for chain-security research, **read-only only**. Never set a private key or mnemonic. Moderately maintained |
| Slither MCP | [trailofbits/slither-mcp](https://github.com/trailofbits/slither-mcp) | Slither static analysis of Solidity (detectors, call graphs, inheritance) as MCP tools | 98★, v2.3.2 released 2026-02-03 | AGPL-3.0 | none | maybe: high value for smart-contract audits. Launch it, never copy code (AGPL). Needs solc/foundry locally |
| GhidraMCP | [LaurieWired/GhidraMCP](https://github.com/LaurieWired/GhidraMCP) | Decompile and annotate binaries through a Ghidra plugin | 11.3k★, release 2.0 on 2026-10-10 | Apache-2.0 | none (needs a local Ghidra install + plugin) | maybe: binary reverse engineering for node and client audits |
| Brave Search MCP | [brave/brave-search-mcp-server](https://github.com/brave/brave-search-mcp-server) | Web, news, image and local search | 1.5k★, v2.1.4 released 2026-09-17 | MIT | Brave Search API key (free credits, then paid plans) | maybe: **not enabled** (key) |
| Tavily MCP | [tavily-ai/tavily-mcp](https://github.com/tavily-ai/tavily-mcp) | Search, extract, map and crawl tuned for agents | 2.4k★, npm 0.2.22 on 2026-08-05, commits to 2026-09 | MIT | Tavily API key (free credits, then paid) | maybe: **not enabled** (key) |
| Sentry MCP | [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp) (now in getsentry/toolkit, npm `@sentry/mcp-server` 0.42.0) | Issues, events, traces and Seer analysis | active (toolkit pushed 2026-10-14) | FSL-1.1-ALv2 (source-available, becomes Apache-2.0 after 2 years) | Sentry auth token / OAuth | maybe: only if the stack adopts Sentry |
| Docker MCP Gateway | [docker/mcp-gateway](https://github.com/docker/mcp-gateway) | Runs catalogued MCP servers in containers with secrets and isolation | 1.6k★, pushed 2026-09-23, no tagged releases | MIT | Docker Engine/Desktop | maybe: a good isolation layer for untrusted servers, but this WSL host has no Docker |
| Blender MCP | [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | Drive Blender (modelling, materials, scenes) | 30.8k★, pushed 2026-10-06 | MIT | none (local Blender + addon) | maybe: CAD/visualisation beside unified-CAD-MCP. Its `execute_blender_code` tool runs arbitrary Python |
| FreeCAD / KiCad MCP | [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp), [mixelpixx/KiCAD-MCP-Server](https://github.com/mixelpixx/KiCAD-MCP-Server) | Parametric CAD, PCB | 2.9k★ / 2.7k★, pushed 2026-10 | MIT | none | already covered: unified-CAD-MCP composes these backends. No separate entry |
| Slack MCP | [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) | Channels, DMs, search | 1.9k★, pushed 2026-07-16; community, not Slack-official | MIT | Slack bot/user tokens (or browser session tokens) | no: unofficial, and the token scope is too broad. No official Slack or Discord MCP server was found |

Not recommended or not found:

- **semgrep/mcp** is archived and deprecated. The Semgrep MCP server now ships in the official `semgrep` binary, so evaluate
  that instead (code scanning, keyless for local rules).
- **modelcontextprotocol/servers-archived** (the old postgres, sqlite, slack, brave-search, puppeteer and gdrive reference
  servers) is archived and unmaintained. Do not use it.
- **Cosmos SDK / CosmWasm.** No maintained MCP server was found on GitHub (only templates and personal repos with 0-1 stars,
  last pushed 2025). For Cosmos chain-security work, use the chain CLIs and LCD/gRPC endpoints through a small, read-only,
  JARVIS-owned server later (same pattern as fixture-mcp), or the Autheo MCP once it has a licence.
- **Serena** (oraios/serena, 30k★, very active) is a strong coding toolkit, but its licence reads as "Other" on GitHub
  and serena-agent on PyPI declares GPL-3.0-or-later. It also overlaps jCodeMunch. Revisit if code navigation becomes a gap.

## Adding one of these to JARVIS

Follow the existing adapter pattern (jcodemunch.js / playwright-mcp.js):

1. Pin commit and package version in upstreams/lock.json.
2. Add an off-by-default adapter that launches the operator-installed binary as a kernel-owned stdio child, checks
   its version against the pin, builds the child env from scratch and enforces a tool grant list.
3. Move the catalog entry from `planned` to `adapter` with its `pin`, add tests (a live test is skipped unless the
   binary env var is set), then update README, docs/SOURCES.md and docs/VERIFICATION.md.
