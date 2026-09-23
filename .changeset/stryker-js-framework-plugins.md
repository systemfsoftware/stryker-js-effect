---
"@systemfsoftware/stryker-js": major
---

Framework format support now arrives as a plugin. A package exporting `strykerFrameworks` and listed in `plugins` teaches a run new file formats — the Angular and Svelte plugins ship for `.html`, `.htm`, `.vue`, and `.svelte` — with no discovery by package name: list each framework package explicitly.

Two plugins claiming one extension resolve first-configured-wins, and the losing claim is reported with the winning and losing module names.

A framework plugin that cannot serve refuses the run before any file is instrumented: a missing peer, a peer version outside the plugin's supported range, or an invalid contribution ends the run as a configuration error (exit code 2), and a plugin module that crashes on import stays an internal error (exit code 4). Each refusal carries a typed reason, so a machine consumer reads it without parsing prose.

A file whose extension no loaded format claims is skipped instead of failing the run: it is reported with its extension and a reason naming the plugin package to add to `plugins`, and the run continues. A file a loaded format claims but cannot parse still fails the run.

The machine-mode stream gains three event kinds — the outcome of loading each configured plugin, the resolved format registry mapping every claimed extension to its format and owning module, and the files skipped for want of a format — and `RunFailed` gains the typed `reason` that ended the run. `STREAM_SCHEMA_VERSION` is now `1.1`; a decoder that switches over the event kinds must handle the new members before it upgrades.
