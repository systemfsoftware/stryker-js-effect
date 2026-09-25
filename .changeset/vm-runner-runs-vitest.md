---
"@systemfsoftware/stryker-js": patch
---

`testRunner: 'vm'` runs Vitest itself on Vitest's isolated `threads` pool instead of an in-process reimplementation, and stays the default `testRunner`. It reports the same test ids, outcomes and per-mutant verdicts as `testRunner: 'vitest'`, so a project whose Vitest config enables browser mode is refused at startup with a message naming `testRunner: 'vitest'`.

Stryker no longer discovers test files for `vm`: Vitest selects them from your config, as it does for `testRunner: 'vitest'`. A run that loads no test files fails the dry run naming `testFiles`.
