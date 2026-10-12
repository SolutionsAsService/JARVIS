# Pinned upstreams (keeping external components up to date)

JARVIS tracks some external repositories by **exact commit** instead of vendoring them. The registry is
[upstreams/lock.json](../upstreams/lock.json) (schema `jarvis.upstream-lock/1`), and the tool is
[scripts/upstream.mjs](../scripts/upstream.mjs). Nothing listed there is committed into JARVIS unless its
`policy` says so; checkouts are fetched on demand into `.jarvis/upstreams/<id>/<sha>` (gitignored).

| Command | What it does |
| --- | --- |
| `npm run upstream -- list` | pins, branch, policy and license finding per component |
| `npm run upstream:check` | `git ls-remote` each tracked branch; prints `current` or `update available` (`--strict` exits 4 when behind) |
| `npm run upstream -- fetch <id> [--ref <sha>]` | shallow-fetch one commit into `.jarvis/upstreams/<id>/<sha>` and write a `.jarvis-upstream.json` marker |
| `npm run upstream:verify` | fetch the pin and require its structural contract to equal the committed snapshot (CI runs this before `npm test`) |
| `npm run upstream -- update <id>` | fetch the branch head and diff its contract against the snapshot; exit 3 on a breaking change |
| `npm run upstream -- update <id> --write` | re-pin: rewrite lock.json, the contract snapshot and the catalog `pin` in src/aos-stack.js; refused on a breaking change unless `--accept-breaking` |

Update procedure: `npm run upstream:check` → `npm run upstream -- update <id>` (read the report) → `--write` →
add a row to docs/SOURCES.md → `npm test` → commit. A breaking report means JARVIS code must change first.

## Registering a component

1. Add an entry to `upstreams/lock.json`: `id`, `name`, `kind`, `repo`, `branch`, full 40-hex `commit`, `pinnedAt`,
   `license` (`spdx`, `finding`, `reuse`), `policy` (e.g. `pin-fetch-only`), optional `contract`, `entrypoints`, `runtime`.
2. Optional: register a contract extractor in `CONTRACTS` in scripts/upstream.mjs (`read(dir)` → JSON contract,
   `diff(snapshot,current)` → `{breaking,changed,compatible,identical}`) and commit its snapshot under
   `upstreams/contracts/<id>.json`. Without one, the component is pin-only.
3. Add `pin: {commit, branch, pinnedAt, update}` to the component in src/aos-stack.js. test/catalog.test.js fails if
   a lock entry has no catalog component or a catalog pin differs from the lock.

Registered today: **dada** (agent skill, contract-checked; see kernel/adapters/dada.js).
