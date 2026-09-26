---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js-vitest-runner": major
---

Counts and durations that cannot be negative are refined where they are declared, through the shared non-negative integer and non-negative finite schemas. Test-runner counts and durations, the clear-text reporter's log limit, the dry-run timeout, a test run's hit counter and limit, and a run's help-error count now refuse a negative value instead of accepting it.
