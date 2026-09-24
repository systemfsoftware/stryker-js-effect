---
"@systemfsoftware/stryker-js-instrumenter": major
---

HTML templates and Svelte components are no longer instrumented by this package
on their own: each format now comes from its framework plugin, the Angular
plugin for `.html`, `.htm`, and `.vue` and the Svelte plugin for `.svelte`, both
published alongside this release. Install the plugin whose format your project
uses and add it to `plugins`. A file whose extension no loaded format claims is
reported in the run's skipped files instead of being instrumented, and `svelte`
is no longer an optional peer dependency of this package; the
`angular-html-parser` dependency moves to the Angular plugin.

The Angular signal ignore rule is unaffected and continues to ship in
`@systemfsoftware/stryker-ignorer-angular`.
