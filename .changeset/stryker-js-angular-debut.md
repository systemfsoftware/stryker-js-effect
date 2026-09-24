---
"@systemfsoftware/stryker-js-angular": minor
---

First release. The Angular framework plugin claims `.html`, `.htm`, and `.vue`
files and hands their `script` regions to the instrumenter, so mutants land in
embedded JavaScript and TypeScript while template expressions are left untouched.

Signal ignoring is not included: pair the plugin with
`@systemfsoftware/stryker-ignorer-angular` to keep the configuration objects of
the signal `input`, `model`, `output`, and query functions out of mutation.

Enable the plugin by installing it and adding it to `plugins`. Its format carries
the version of the HTML parser it resolved, so upgrading that parser invalidates
the mutant results an earlier incremental run remembered for its files.
