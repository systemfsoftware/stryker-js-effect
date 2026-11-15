---
"@systemfsoftware/stryker-js": patch
---

The clear-text, progress and JSON reporters now decide only the outcome of a report (which mutants went undetected, the per-file scores, how far the progress bar moved) and build their text in formatters their write phase calls. What they print is unchanged.
