---
'@systemfsoftware/stryker-ignorer-kit': minor
---

Debut: authoring and testing kit for the ignorer family. `defineIgnorer` compiles typed
visitors (visited node narrowed by key, typed ancestor context via `parentIf`/`ancestorIf`)
into the plain `Ignorer` wire contract; the `./tester` entry's `testIgnorer` verifies any
compiled ignorer from source snippets, registering one test per case.
