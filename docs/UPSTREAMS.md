# Pinned upstreams (keeping external components up to date)

JARVIS tracks some external repositories by **exact commit** instead of vendoring them. The registry is
[upstreams/lock.json](../upstreams/lock.json) (schema `jarvis.upstream-lock/1`), and the tool is
[scripts/upstream.mjs](../scripts/upstream.mjs). Nothing listed there is committed into JARVIS unless its
`policy` says so; checkouts are fetched on demand into `.jarvis/upstreams/<id>/<sha>` (gitignored).

| Command | What it does |
| --- | --- |
| `npm run upstream -- list` | pins, branch, policy and license finding per component |
| `npm run upstream:check` | `git ls-remote` each tracked branch; prints `current` or `update available` (`--strict` exits 4 when behind) |
| `npm run upstream -- fetch <id> [--ref <sha>]` | shallow-fetch one commit into `.jarvis/upstreams/<id>/<sha>` (blobless + sparse when the lock entry has `fetch`) and write a `.jarvis-upstream.json` marker |
| `npm run upstream:verify` | fetch every pin and require each structural contract to equal its committed snapshot (CI runs this before `npm test`; `verify <id>` for one) |
| `npm run upstream -- update <id>` | fetch the branch head and diff its contract against the snapshot; exit 3 on a breaking change |
| `npm run upstream -- update <id> --write` | re-pin: rewrite lock.json, the contract snapshot and the catalog `pin` in src/aos-stack.js; refused on a breaking change unless `--accept-breaking` |
| `npm run upstream -- update <id\|--all> --write --test` | as above, then run `npm test` against the new pin; if it fails the previous lock, snapshot and catalog pin are restored (exit 5) |

Update procedure: `npm run upstream:check` → `npm run upstream -- update <id>` (read the report) →
`npm run upstream -- update <id> --write --test` → add a row to docs/SOURCES.md → commit. A breaking report means
JARVIS code must change first. Re-pinning always tracks the component's `branch` (main for everything registered today).

### Example: updating gm-mcp from its main branch

```sh
npm run upstream:check                                  # gm-mcp ... "update available"
npm run upstream -- update gm-mcp                       # launches the new bundle, diffs tools/lockdown switches
npm run upstream -- update gm-mcp --write --test        # re-pin + npm test; rolled back automatically on failure
git diff upstreams src/aos-stack.js                     # review, add a docs/SOURCES.md row, commit
```

The gm-mcp contract extractor launches the fetched bundle once (locked down, throwaway state dir) and records the
bundle sha256, package/server version, each tool's input-schema hash and whether every lockdown env switch JARVIS
relies on is still in the bundle. Breaking: `gm_codemode` removed, a new required argument, an argument removed, or a
lockdown switch gone. Changed (re-pin only): bundle bytes, version, tools added/removed or schemas changed. The
runtime adapter refuses a checkout whose bundle sha256 or live tool-schema hash differs from the snapshot, so a
stale or tampered checkout fails closed until it is re-pinned.

### Example: updating last30days from its main branch

```sh
npm run upstream:check                                  # last30days ... "update available"
npm run upstream -- update last30days                   # blobless sparse fetch of the head, diffs the contract
npm run upstream -- update last30days --write --test    # re-pin + npm test (runs the new engine on --mock); rolled back on failure
git diff upstreams src/aos-stack.js                     # review, add a docs/SOURCES.md row, commit
```

The fork carries large media, so a plain clone or full-tree fetch fails. Its lock entry therefore sets
`fetch: {filter: "blob:none", sparse: ["/*", "!/media/", "!/skills/last30days/assets/", "!/README.*.md"]}`, and
scripts/upstream.mjs does `git init` + non-cone sparse-checkout + `git fetch --depth 1 --filter=blob:none origin <sha>`
+ `checkout`, so blobs outside the sparse set are never downloaded. The last30days contract is read statically
(no engine run): skill name/version/license, LICENSE = MIT, `requires-python`, required paths (engine, keyless
source modules, mcp/manifest.json), every argparse long flag plus `--emit`/`--web-backend` choices, the source list,
the agent JSON export schema version, the clean-config and `FROM_BROWSER=off` switches, and file hashes. Breaking: a
flag JARVIS passes removed (above all `--no-browser-cookies`), `--emit json` or `--web-backend none` gone, a keyless
source gone, an export schema major bump, a `requires-python` change, a privacy switch gone or the license no longer
MIT. Changed (re-pin only): version, flags or sources added/removed elsewhere, export schema minor, file contents.

## Registering a component

1. Add an entry to `upstreams/lock.json`: `id`, `name`, `kind`, `repo`, `branch`, full 40-hex `commit`, `pinnedAt`,
   `license` (`spdx`, `finding`, `reuse`), `policy` (e.g. `pin-fetch-only`), optional `contract`, `entrypoints`, `runtime`,
   and optional `fetch` (`filter`, non-cone `sparse` patterns) for repositories too large to fetch whole.
2. Optional: register a contract extractor in `CONTRACTS` in scripts/upstream.mjs (`read(dir)` → JSON contract,
   `diff(snapshot,current)` → `{breaking,changed,compatible,identical}`) and commit its snapshot under
   `upstreams/contracts/<id>.json`. Without one, the component is pin-only.
3. Add `pin: {commit, branch, pinnedAt, update}` to the component in src/aos-stack.js. test/catalog.test.js fails if
   a lock entry has no catalog component or a catalog pin differs from the lock.

Registered today:

- **dada**: agent skill, contract-checked (kernel/adapters/dada.js).
- **gm-mcp**: MCP server, contract-checked by launching it (kernel/adapters/gm-mcp.js), policy `pin-fetch-launch`.
- **last30days**: research agent skill + Python engine, MIT (reuse cleared), contract-checked statically
  (kernel/adapters/last30days.js), policy `pin-fetch-only`, blobless sparse fetch.
- **unified-cad-mcp**: MCP server, pin-only (no contract, no adapter); `check` reports upstream movement and
  `update unified-cad-mcp --write` moves the pin. Re-review its catalog note when you do.
