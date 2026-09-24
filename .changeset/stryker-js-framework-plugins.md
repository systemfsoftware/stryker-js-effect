---
"@systemfsoftware/stryker-js": major
---

Framework format support now arrives as a plugin. A package exporting `strykerFrameworks` and listed in `plugins` teaches a run new file formats — the Angular and Svelte plugins ship for `.html`, `.htm`, `.vue`, and `.svelte`. List each framework package by name: a bare package name resolves from the project, and a `file://` URL keeps working. There is no discovery, so a plugin you never list contributes nothing.

When two plugins claim one extension, the one listed first in `plugins` owns it, and the losing claim is reported with the winning and losing module names.

The `Framework` type a plugin's `strykerFrameworks` entries satisfy, and the AST `Node` type an ignorer's `shouldIgnore` receives, are exported beside `Ignorer`.
