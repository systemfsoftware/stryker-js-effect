---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

Mutation score thresholds are declared once, as `Report.ThresholdsSchema`: `high`, `low`, and a `break` that is null when no breaking threshold is configured. The option file and the mutation report decode the same schema, and a pair whose `low` is above its `high` is refused with "a mutation score threshold pair has low at or below high".

The mutation report's thresholds now include `break`, so a consumer reads the breaking threshold from the report instead of recovering it from the embedded reporter configuration.
