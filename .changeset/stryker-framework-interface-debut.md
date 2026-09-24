---
"@systemfsoftware/stryker-framework-interface": minor
---

First release. A framework plugin claims a format (`formatId`, `extensions`,
`language`, `ownerVersion`, `contractVersion`), parses files into embedded
documents, and receives a `FrameworkContext` of `parseScript`, `printScript`,
and `instrumentationHeader`. Every script region carries the `Program` the core
parsed for it, so a hook never re-parses or re-checks one.

A plugin whose peer is missing, outside its supported range, or not exporting
what the plugin needs exports a `FrameworkRefusal` in place of its framework,
with the reason `PeerMissing`, `PeerVersionUnsupported`, or `PeerUnrecognized`.

`FrameworkPackageManifest` types a plugin package's top-level `strykerFramework`
field naming the extensions its framework claims, which the host reads to name
that package in a skip reason without importing it.
