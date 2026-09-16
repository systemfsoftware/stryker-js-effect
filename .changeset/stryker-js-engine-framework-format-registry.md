---
"@systemfsoftware/stryker-js-engine": major
---

a run now reports its plugin load on the machine stream — an event carrying each
configured plugin's outcome, its declared contributions, and any name or
extension shadowing — followed by the resolved format registry, each claimed
extension mapped to the format and the module that owns it, and — after
instrumentation — the files no installed format claimed, with the extension and
the reason each was skipped; a framework plugin's bundled `Ignore` contribution
is selected automatically, so it needs no `ignorers` entry; a plugin that fails to
load now reports the prepare phase and a terminal failure carrying the typed
reason and the exit code that reason decides, instead of failing without a phase;
the plugin list the engine ships uses the default plugin glob rather than
individual plugin names, so a project that extends it discovers framework plugins
too
