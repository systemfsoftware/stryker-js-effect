---
"@systemfsoftware/stryker-js": major
---

Service tags no longer carry their implementations. `RunEvent.RunEventDrainLive` is now `RunEvent.drainLayer`, and the `RunEnvironment.stage` and `RunEnvironment.forStream` statics are now `Engine.stage` and `Engine.forStream`. The `layer` statics on `Engine.IdGenerator` and `GitDiff.GitDiff` are removed: `Engine.stage` supplies `IdGenerator`, and `Engine.nodePlatformLayer` supplies `GitDiff`.
