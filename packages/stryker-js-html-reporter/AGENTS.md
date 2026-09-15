# AGENTS.md — `@systemfsoftware/stryker-js-html-reporter`

HTML reporter plugin for the mutation engine: `strykerPlugins` declares the `Reporter` kind (`html`), and `makeHtmlReporter` is the factory a host wires — the CLI bundles this package as its `reporters/html` entry.

> The mutation-testing subtree group file did not travel with this package, and neither the contract lane nor the api-extractor surface (`etc/*.api.md`) is carried in this repository.

## Rules

| ID      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Gate                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **HR1** | The written document is self-contained: the `mutation-testing-elements` client bundle is embedded in it and no path of the writing host appears in it. Two resolutions feed that embed and both stay — a bundled build inlines the bundle through `__STRYKER_HTML_REPORTER_CLIENT_BUNDLE__` (the CLI sets that `define` when it builds `reporters/html`), and on its own the reporter resolves `mutation-testing-elements/dist/mutation-test-elements.js` from disk. | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-factory.integration.test.ts`                       |
| **HR2** | Report text reaches the document only through `escapeHtmlTags`: the serialized run result is interpolated into a `<script>` element, so report data must not be able to close it.                                                                                                                                                                                                                                                                                    | `review` — the reviewer confirms the serialized run result is passed through `escapeHtmlTags` at the interpolation site, never interpolated raw |
| **HR3** | Only `MutationTestReportReady` writes the file named by `options.htmlReporter.fileName`: an interrupted run writes nothing, and a stream failing after the report reaches the caller leaves the written report on disk.                                                                                                                                                                                                                                              | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-cleanup.integration.test.ts`                       |
| **HR4** | The same run writes the same document twice: nothing in the output depends on the clock, the host path, or a run identity.                                                                                                                                                                                                                                                                                                                                           | `pnpm --filter @systemfsoftware/stryker-js-html-reporter exec vitest run tests/html-reporter-factory.integration.test.ts`                       |
| **HR5** | Rebuild after a source change (subtree rule): this package's plugin-registry suite and the CLI's `reporters/html` both read built `dist/`, so an unbuilt edit is not what the next run tests.                                                                                                                                                                                                                                                                        | `pnpm --filter @systemfsoftware/stryker-js-html-reporter build`                                                                                 |
| **HR6** | This package carries no `stryker.config.json` and enrolls no mutation run of its own — never add one.                                                                                                                                                                                                                                                                                                                                                                | `git ls-files 'packages/stryker-js-html-reporter/stryker.config.json'` prints nothing                                                           |

### Calibration pair — HR2

- `wrong:` `app.report = ${JSON.stringify(event.report)}` — report text lands inside the `<script>` element, so a `</script>` in that text closes it.
- `right:` the same interpolation wrapped in `escapeHtmlTags(...)`, which breaks every `<` coming from report data so it can never precede `/script`.

## Verification

```bash
pnpm --filter @systemfsoftware/stryker-js-html-reporter build
pnpm --filter @systemfsoftware/stryker-js-html-reporter typecheck
pnpm --filter @systemfsoftware/stryker-js-html-reporter lint
pnpm --filter @systemfsoftware/stryker-js-html-reporter test
pnpm --filter @systemfsoftware/stryker-js-html-reporter attw
```
