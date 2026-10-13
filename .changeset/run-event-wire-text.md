---
"@systemfsoftware/stryker-js-cli-contract": minor
---

`RunEvent.RunEventWireText` decodes the whole machine-mode output of a run into its run events. Blank and whitespace-only lines are skipped, and the first line that is not a run event is refused at its 0-based line position. Encoding writes one wire line per event.
