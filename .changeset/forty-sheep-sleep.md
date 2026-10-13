---
"@systemfsoftware/stryker-js": major
---

Breaking: two public Layer members are renamed and one export is removed, so every service module hands out Layers only as members of its Service class, under the pack's names. `Engine.RunEnvironment.stage` is now `Engine.RunEnvironment.layerStage`, with the same two call signatures and the same `Layer<RunStageServices, never, EnginePorts>`. `RunEvent.RunEventDrain.fileLayer` is now `RunEvent.RunEventDrain.layerFile`. `RunEvent.RunEventDrainLive` is removed: use `RunEvent.RunEventDrain.layer`, which it aliased. Behaviour is unchanged.
