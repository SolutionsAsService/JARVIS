# Deploy the frontend

This release is a static frontend. No database, API secrets or assistant engine is required to show it. There is no backend to deploy yet.

## Build artifact

Node 24.15+:

    npm ci
    npm test
    npm run build

Publish the **contents of dist/** as your web root. Build command: npm run build. Output directory: dist. Relative assets and hash navigation support / and subpaths; no history rewrite required. Serve via HTTPS, not a public development server.

## Shadw

Assuming you mean shadw.cloud. Official @shadw/cli package metadata inspected 2026-10-07 lists auth login, deploy and projects list commands. Its README does not establish this project's static-site flags/build fields. No provider manifest or target is guessed here.

Use your account's supported static deployment flow for dist/; if its UI builds from GitHub, use the build/output above. If it accepts containers, this repo includes a non-root static Node server container on PORT (default 8080). Use the platform's actual documented configuration.

Optional CLI discovery in your own deployment environment:

    npx @shadw/cli@0.1.0 --help
    npx @shadw/cli@0.1.0 auth login
    npx @shadw/cli@0.1.0 deploy --help

The inspected README notes some platform binaries may not yet be published. Do not store SHADW_TOKEN in frontend code or commit it. No Shadw login, deployment, spend or account configuration was performed.

Sources: https://www.npmjs.com/package/@shadw/cli ; https://shadw.cloud

## Container alternative

    docker build -t jarvis-preview .
    docker run --rm -p 8080:8080 jarvis-preview

Serves built static files only, not the repo or a privileged installer. Container execution is optional; static dist/ hosting is simplest. Actual verification is in docs/VERIFICATION.md.

## Production hardening

Hosting proxy should enforce HTTPS and security headers. The bundled static server has a CSP permitting optional Google Fonts and no cross-origin API connections. Add explicit API origins only with a reviewed integration. Never add live Gateway tokens or privileged device pairing to this public preview.
