---
"@systemfsoftware/stryker-js": patch
---

Installing the CLI no longer nests the HTML reporter, plugin-interface, plugin-runtime, instrumenter, or ignorer-interface packages. The CLI still includes the HTML reporter. Those packages remain installable on their own.
