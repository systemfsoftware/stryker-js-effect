---
"@systemfsoftware/stryker-ignorer": minor
---

first release: the plain ignorer protocol — the `PlainIgnorer` descriptor (`{ name, shouldIgnore }`), the structural `NodePath`, and the `ancestorsOf` walker — as a zero-dependency package with no Effect types on its published surface; ignorer authors migrating from `@systemfsoftware/stryker-plugins` export `strykerIgnorers` from their module instead of a `strykerPlugins` plugin array
