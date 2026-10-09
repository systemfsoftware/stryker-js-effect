---
"@systemfsoftware/stryker-js-typescript-checker": patch
---

A tsconfig `extends` that names a package now resolves the way TypeScript 7 does. When the package manifest declares `exports`, only the files `exports` lists are candidates. A config file named after the subpath, or the package's root config, is no longer used when `exports` leaves the subpath unmapped, points at a missing file, or has no active condition. The search then moves on to the same package in an outer `node_modules`. A condition whose file is missing now falls through to the next active condition, as in an `exports` array. Previously only the first active condition was tried. A `null` in `exports` ends the search entirely, outer `node_modules` included. An `exports` value of `null`, `false` or `""` still counts as absent. The program digest therefore follows the base config the compiler actually loads.
