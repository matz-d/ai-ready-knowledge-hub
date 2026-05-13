# npm supply-chain response: Mini Shai-Hulud wave

Date: 2026-05-13

Reference: https://www.aikido.dev/blog/mini-shai-hulud-is-back-tanstack-compromised

## Status

This repository is not currently affected by the Mini Shai-Hulud package set described on 2026-05-12.

Checks performed:

- Searched `package.json` and `package-lock.json` for affected package namespaces and named packages.
- Searched the installed dependency tree with `npm ls` for high-signal affected packages.
- Searched the repository and `node_modules` for payload markers:
  - `execution.js`
  - `setup.mjs`
  - `router_init.js`
  - `router_runtime.js`
  - `tanstack_runner.js`
  - `@tanstack/setup`
  - `github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c`
- Searched repository-level injection points:
  - `.claude/setup.mjs`
  - `.claude/router_runtime.js`
  - `.vscode/setup.mjs`
  - `.vscode/tasks.json`
  - `.github/workflows/codeql_analysis.yml`
- Searched user-level persistence files:
  - `~/Library/LaunchAgents/com.user.gh-token-monitor.plist`
  - `~/.config/systemd/user/gh-token-monitor.service`

## Repository action taken

- Added `npm run security:ioc:mini-shai-hulud` for repeatable IOC scanning.
- Extended the IOC scan for the second-wave persistence and exfiltration markers documented by GMO Flatt Security.
- Removed vulnerable `xlsx` usage from production code and tests.
- Replaced XLSX parsing/generation with `exceljs`.
- Updated direct Firestore dependency to `@google-cloud/firestore` 8.x.

## Operating guidance

Run these before dependency updates and release work:

```sh
npm run security:ioc:mini-shai-hulud
npm run security:audit
```

If the IOC scan fails, treat the machine or CI runner that installed the package as exposed and rotate credentials from that environment, including GitHub tokens, npm tokens, cloud credentials, deployment secrets, and any CI secrets available to that runner.

For a positive second-wave hit, remove persistence before rotating credentials. In particular, stop and remove `gh-token-monitor` LaunchAgent/systemd entries first, then rotate GitHub/npm/cloud credentials.

Valid npm provenance is not sufficient proof that a package is clean when attacker-controlled install-time code may have run inside the publishing workflow.

## Residual audit items

`npm run security:audit` still reports transitive Genkit / Google Cloud dependency findings:

- `@opentelemetry/sdk-node` / `@opentelemetry/auto-instrumentations-node`: high severity Prometheus exporter crash advisory.
- `@tootallnate/once`: low severity issue through older Google Cloud request dependencies.

The OpenTelemetry package has patched releases, but forcing them with npm `overrides` currently creates incompatible peer dependency resolution for Genkit's OpenTelemetry 1.x stack and introduces other audit findings. Do not force that override without a Genkit-compatible upgrade path and a live Genkit smoke test.

Current mitigation:

- Keep Genkit packages updated within the supported release line.
- Do not expose telemetry / Prometheus exporter endpoints publicly.
- Re-run `npm run security:audit` after Genkit publishes a compatible dependency update.
