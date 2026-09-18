---

---

Reporters now write through the `Stdio` service instead of the `process` global. `BuiltinReporterServices` (renamed from `JsonReporterDeps`) requires a `stdio` field, and `EnginePorts` now requires `Stdio` — provide it alongside the file system and path layers when composing the run layer.
