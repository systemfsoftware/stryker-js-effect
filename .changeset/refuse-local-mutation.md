---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-cli-contract": minor
---

A mutation run now starts only on main CI. The `run` command, the programmatic run entry point, and every other surface that begins a mutation run refuse to start unless the process runs under GitHub Actions (`GITHUB_ACTIONS=true`); anything else — a developer machine, a fork, or another CI — exits non-zero instead of running mutants. A refused run ends the machine-readable output with a new `refused` event whose `rule` is `mutation-runs-on-main-ci`, and the machine-stream schema version is now `3.0`. Dry runs (`--dryRunOnly`), `--version`, and config and help commands are unaffected.
