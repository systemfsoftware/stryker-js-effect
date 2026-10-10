---
"@systemfsoftware/stryker-js": major
---

`ImportClosure.analyzeImportClosure` now needs a `SourceParser` service, and `Engine.EnginePorts` includes it. `Engine.nodePlatformLayer` provides it, so code that runs the analysis or the engine under that layer needs no change. Code that builds the engine's ports itself must add a `SourceParser` layer. The new `SourceParser` namespace exports the service and its shape.

Import closure analysis gives the same closures, `open` flags and digests as before. A source file holding a regex or bigint literal is parsed as it was.
