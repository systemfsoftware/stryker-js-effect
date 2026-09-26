---
"@systemfsoftware/stryker-js-plugin-interface": major
"@systemfsoftware/stryker-js": major
---

Exit codes are one value: `Plugin.ExitCode`, an integer between 0 and 255. The machine stream's failure event, the command's run output, and the run conclusion all carry it, and a run conclusion's outcome is the closed set of run-outcome tags rather than free text.

`Plugin.ExitCodeFromClass` stays the single exit-class to baseline-code mapping; read a code through it instead of writing the number where an exit class has to become an exit code.
