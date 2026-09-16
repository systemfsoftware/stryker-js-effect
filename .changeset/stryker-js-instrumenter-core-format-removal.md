---
"@systemfsoftware/stryker-js-instrumenter": major
---

HTML templates and Svelte components are no longer instrumented by this package
on their own: each format now comes from its framework plugin, the Angular
plugin for `.html`, `.htm`, and `.vue` and the Svelte plugin for `.svelte`, both
published alongside this release. Install the plugin whose format your project
uses; a file no installed format claims is reported in the run's skipped files
instead of being instrumented, and Svelte is no longer an optional peer
dependency here.

The Angular signal ignore rule leaves with the template format: it now ships
inside the Angular plugin. Three exports are gone with it — `angularIgnorer`,
`frameworkPluginsFileUrl`, and the empty `strykerPlugins` stub — as are the
Svelte-specific parser error types.
