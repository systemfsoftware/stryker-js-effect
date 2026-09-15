# @systemfsoftware/stryker-js-html-reporter

## Rules

| ID      | Obligation                                                            | Gate                                                                                                                      |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **HR1** | Output HTML report embeds client dashboard bundle self-contained      | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-factory.integration.test.ts` |
| **HR3** | Report writes only on `MutationTestReportReady` event                 | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-cleanup.integration.test.ts` |
| **HR5** | Package exports built `dist/` bundle; must rebuild after source edits | `pnpm --filter @systemfsoftware/stryker-js-html-reporter build`                                                           |
