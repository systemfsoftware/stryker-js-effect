## 10.0.0

### Major Changes

- The machine-mode event stream now tags every event document with `_tag` (previously `kind`), matching the `RunEvent` schema tags. The wire line schema `RunEventWireLine` is exported, so consumers can decode machine-mode stdout lines with the same schema the CLI encodes them with. The event stream's composition surface is now public: `makeRunEventStream`, `RunEventStream`, `RunEventDrain`, `RunEventDrainLive`, and `ResolvedModeInput`.

  Consumers parsing machine-mode stdout must read the `_tag` field instead of `kind`.

### Patch Changes

- A checker that fails now fails mutation testing with that checker's cause, instead of crashing with an empty error. The TypeScript checker type-checks each mutant, so compile errors appear in the report. Verdict counts are non-negative integers; `Metrics` is a class you can build from mutant statuses; a threshold `low` may not exceed `high`.
