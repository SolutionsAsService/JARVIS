# Autheo demo receipts (test fixture)

Generated 2026-10-12 with `python -m autheo_agent_environment.demo --output <dir>` from
https://github.com/SolutionsAsService/autheo-agent-environment at commit
`8106edd0d68747c3a17e234c967da3b5449298ec` (Python 3.12.3, PyJWT 2.15.1, cryptography 50.0.2, pydantic 2.14.1),
in a throwaway virtualenv. Copied unchanged: `source-audit.json`, `destination-audit.json`,
`issuer-public.pem`, `demo-report.json`.

The demo keys were ephemeral and discarded by the demo itself; no private key is stored here.
The receipts record simulated policy decisions (`executed: false`) and prove nothing about real actions.
They are verified historically (expiry not enforced), exactly like the upstream `audit` CLI.
The upstream project is MIT licensed.
