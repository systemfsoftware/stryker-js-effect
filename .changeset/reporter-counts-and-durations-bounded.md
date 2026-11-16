---
"@systemfsoftware/stryker-js-plugin-interface": major
---

Decoding is stricter for the counts and durations reporters add up.

- `Report.MutantResult.testsCompleted` and `Mutant.testsCompleted` are non-negative integers no greater than `Number.MAX_SAFE_INTEGER`. A report or mutant with a fractional, negative or larger value no longer decodes. The published `contract/report.schema.json` declares the field as an integer between 0 and 9007199254740991, which is narrower than the upstream mutation-testing-report-schema 3.9.0, where it is any number.
- `Reporter.RunTimingSchema` (`net`, `overhead`) and `Reporter.ReporterPlanDescriptorSchema.netTime` are non-negative numbers no greater than `Number.MAX_SAFE_INTEGER`. They may still be fractional. A dry-run timing or plan above that bound no longer decodes.
- `Reporter.DurationMs` is the new schema for those durations.

Reports written by Stryker already meet these bounds and still decode.
