---
"@systemfsoftware/stryker-js": major
---

Human or machine output is declared once, as `OutputMode`, and the reason for that choice once, as `ModeSignal`. The run stream's start and verdict events, the resolved configuration environment, and the machine framer all decode those two schemas.

A caller that spelled a mode as a plain string union imports the schema's type instead; the duplicate literal lists are gone.
