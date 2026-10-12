# Autheo v1 cross-language test vectors (test fixture)

`autheo-v1-vectors.json` is copied byte-for-byte from
https://github.com/SolutionsAsService/autheo-agent-environment at commit
`68bfb5550925efadd2fdfaafff5273f63475f219` (0.2.0, path `tests/vectors/autheo-v1-vectors.json`,
produced upstream by `python -m autheo_agent_environment vectors generate`).

SHA-256 of the copied file: `038970ad331cf6cc41dda671533cff1efc62d5ae1ee096380470be9cb3de712f`
(asserted by `test/autheo-v1.test.js`).

Contents: canonical-JSON (`autheo-cjson/1`) cases, two Ed25519 keys, 14 signed documents (6 valid, 8
invalid with the expected error class), a 4-receipt chain with its head, a tampered chain and policy /
passport digests. Normative text: upstream `docs/SPEC-SIGNATURES.md` at the same commit.

The private seeds in this file are PUBLIC TEST VALUES published upstream; never use them outside tests.
The upstream project is MIT licensed (see `kernel/vendor/autheo/LICENSE`). To refresh: copy the file from a
newer upstream commit, update the commit and SHA-256 here and in the test, and re-run `npm test`.
