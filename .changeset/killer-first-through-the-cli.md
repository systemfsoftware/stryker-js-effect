---
"@systemfsoftware/stryker-js": none
---

Tests: the check that a refused re-run starts each mutant with its previous killing test now runs the built CLI twice instead of the engine three times, and its slow test waits instead of spinning, so it no longer runs into the 60-second test limit on a busy CI runner.
