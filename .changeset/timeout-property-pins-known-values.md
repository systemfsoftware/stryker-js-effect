---
"@systemfsoftware/stryker-js": none
---

The in-source property for the persisted timeout fields now pins its outputs against known values for a wall-clock timeout with and without reproducing evidence, a hit-limit timeout, and a non-timeout. The mutation dry run's constant-impostor gate no longer goes vacuous under the reduced property budget of a mutation worker (30 runs, fixed seed), where the generated draws held no timeout case. Nothing published changes.
