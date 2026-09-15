# @systemfsoftware/stryker-js-cli

## Rules

| ID         | Obligation                                                                             | Gate                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI-B1** | Package must retain `prepare` script running `tsdown`; `bin` points to `dist/main.mjs` | `pnpm --filter @systemfsoftware/stryker-js-cli exec stryker --help`                                                                                |
| **CLI-S1** | `package.json#exports` must contain only `./package.json`                              | `node -p "JSON.stringify(require('./apps/stryker-js-cli/package.json').exports)"`                                                                  |
| **CLI-D1** | Bundle imports only `node:` builtins; zero runtime dependencies                        | `pnpm --filter @systemfsoftware/stryker-js-cli build`                                                                                              |
| **CLI-D2** | Parser is aliased to WASI build (`oxc-parser`); WASM binary in `dist/`                 | `node apps/stryker-js-cli/dist/main.mjs --version`                                                                                                 |
| **CLI-D3** | HTML reporter bundle baked at build-time into `dist/reporters/html.mjs`                | `node -e "const s=fs.readFileSync('apps/stryker-js-cli/dist/reporters/html.mjs','utf8'); if(!s.includes('MutationTestElements')) process.exit(1)"` |
| **CLI-L1** | `oxlint.config.ts` extends `@systemfsoftware/all` plus strict trio                     | `pnpm --filter @systemfsoftware/stryker-js-cli lint`                                                                                               |

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-cli build
pnpm --filter @systemfsoftware/stryker-js-cli typecheck
pnpm --filter @systemfsoftware/stryker-js-cli test
pnpm --filter @systemfsoftware/stryker-js-cli lint
```
