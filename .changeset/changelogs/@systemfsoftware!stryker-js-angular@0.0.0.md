## 0.0.0

### Minor Changes

- First release. The Angular framework plugin claims `.html`, `.htm`, and `.vue`
  files and hands their `script` regions to the instrumenter, so mutants land in
  embedded JavaScript and TypeScript while template expressions are left
  untouched.

  List it by package name in `plugins`. The package's manifest declares
  `strykerFramework` with the extensions it claims, so a run names it in a skip
  report when a file type it owns is left unconfigured. Its format carries the
  version of the HTML parser it resolved, so upgrading that parser invalidates the
  mutant results an earlier incremental run remembered for its files.

  Signal ignoring is not included: pair the plugin with
  `@systemfsoftware/stryker-ignorer-angular` to keep the configuration objects of
  the signal `input`, `model`, `output`, and query functions out of mutation.
