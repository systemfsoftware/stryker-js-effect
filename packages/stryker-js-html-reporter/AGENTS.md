# @systemfsoftware/stryker-js-html-reporter

HTML mutation testing report generator: embeds interactive `mutation-testing-elements` dashboard.

## Rules

| ID      | Obligation                                                                               | Gate                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **HR1** | Output HTML report embeds client dashboard bundle self-contained                         | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-factory.integration.test.ts` |
| **HR2** | Report JSON injected strictly through `escapeHtmlTags` to prevent `<script>` breakout    | `review`                                                                                                                  |
| **HR3** | Report writes only on `MutationTestReportReady` event; interrupted runs write zero files | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-cleanup.integration.test.ts` |
| **HR4** | Report generation is deterministic across identical runs                                 | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-factory.integration.test.ts` |
| **HR5** | Package exports built `dist/` bundle; must be rebuilt after source modifications         | `pnpm --filter @systemfsoftware/stryker-js-html-reporter build`                                                           |
| **HR6** | No `stryker.config.json` or self-mutation lane enrolled in this package                  | `git ls-files 'packages/stryker-js-html-reporter/stryker.config.json'` returns 0 files                                    |

### Calibration pairs

- **HR2** — `wrong:` `app.report = ${JSON.stringify(event.report)}`; `right:` `app.report = ${escapeHtmlTags(JSON.stringify(event.report))}`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-html-reporter build
pnpm --filter @systemfsoftware/stryker-js-html-reporter typecheck
pnpm --filter @systemfsoftware/stryker-js-html-reporter lint
pnpm --filter @systemfsoftware/stryker-js-html-reporter test
pnpm --filter @systemfsoftware/stryker-js-html-reporter attw
```
