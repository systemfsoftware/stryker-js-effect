# @systemfsoftware/stryker-js-cli

The `stryker` executable: process entrypoint, NDJSON run-event streaming, signal lifecycle, exit classifications.

## Rules

| ID         | Obligation                                                                                         | Gate                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI-B1** | Package must retain `prepare` script running `tsdown`; `bin` points to uncommitted `dist/main.mjs` | `pnpm --filter @systemfsoftware/stryker-js-cli exec stryker --help` exits 0 on clean install                                                               |
| **CLI-M1** | No mutation scripts or `stryker.config.json` enrolled in this package                              | `review`                                                                                                                                                   |
| **CLI-S1** | `package.json#exports` must contain only `./package.json` and be generated via `tsdown.config.ts`  | `node -p "JSON.stringify(require('./apps/stryker-js-cli/package.json').exports)"` prints `{"./package.json":"./package.json"}`                             |
| **CLI-D1** | Bundle imports only `node:` builtins; zero runtime dependencies in manifest                        | `pnpm --filter @systemfsoftware/stryker-js-cli build` fails if non-node imports are emitted                                                                |
| **CLI-D2** | Parser is aliased to WASI build (`oxc-parser`); WASM binary output is colocated in `dist/`         | `node apps/stryker-js-cli/dist/main.mjs --version` writes zero stderr; WASM binary exists in `dist/`                                                       |
| **CLI-D3** | HTML reporter bundle is baked at build-time via `define` into `dist/reporters/html.mjs`            | `node -e "const s=fs.readFileSync('apps/stryker-js-cli/dist/reporters/html.mjs','utf8'); if(!s.includes('MutationTestElements')) process.exit(1)"` exits 0 |
| **CLI-D4** | Container-backed contract test suite is intentionally excluded from this repository                | `review`                                                                                                                                                   |
| **CLI-L1** | `oxlint.config.ts` extends `@systemfsoftware/all` plus workspace strict trio                       | `pnpm --filter @systemfsoftware/stryker-js-cli lint` exits 0                                                                                               |

### Calibration pairs

- **CLI-M1** — `wrong:` adding `mutation` script to `package.json` without an automated gate; `right:` package omits self-mutation scripts.
- **CLI-D4** — `wrong:` re-adding `test:contract` script expecting docker fixtures; `right:` contract tests excluded until containerless lane is designed.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-cli build
pnpm --filter @systemfsoftware/stryker-js-cli typecheck
pnpm --filter @systemfsoftware/stryker-js-cli test
pnpm --filter @systemfsoftware/stryker-js-cli lint
```
