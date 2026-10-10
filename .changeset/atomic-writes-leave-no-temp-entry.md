---
"@systemfsoftware/stryker-js": patch
---

Writing the incremental report, a checkpoint or a stored verdict no longer leaves a temp directory beside the file, and a write cut short when the run ends no longer leaves a temp file in the project. A file left that way counted as a project file, so the next incremental run could refuse every verdict as `closureChanged`.
