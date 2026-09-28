---
"@systemfsoftware/stryker-js-plugin-interface": patch
---

Fixed mutant coverage whose hit counts were keyed by anything other than a mutant id being silently emptied on decode — such a payload now fails validation, so a mismatched runner/plugin pair reports the key mismatch instead of planning every mutant as uncovered.
