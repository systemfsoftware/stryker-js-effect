---
"@systemfsoftware/stryker-js": patch
---

Writing the incremental report, a checkpoint or a stored verdict no longer leaves a temp directory beside the file, and a write that fails or is interrupted removes its temp file. A run killed mid-write can still leave the incremental report's temp file beside it; the next run no longer counts that file as a project file, so it no longer refuses the saved dry run and every verdict as `closureChanged`.
