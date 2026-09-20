---
"@systemfsoftware/stryker-js": major
"@systemfsoftware/stryker-js-plugin-interface": none
"@systemfsoftware/stryker-js-typescript-checker": none
"@systemfsoftware/stryker-js-vitest-runner": none
"@systemfsoftware/stryker-js-html-reporter": none
"@systemfsoftware/stryker-js-instrumenter": none
"@systemfsoftware/stryker-js-plugin-runtime": none
"@systemfsoftware/stryker-test-contribution": none
---

The machine-mode event stream now tags every event document with `_tag` (previously `kind`), matching the `RunEvent` schema tags. The wire line schema `RunEventWireLine` is exported, so consumers can decode machine-mode stdout lines with the same schema the CLI encodes them with. The event stream's composition surface is now public: `makeRunEventStream`, `RunEventStream`, `RunEventDrain`, `RunEventDrainLive`, and `ResolvedModeInput`.

Consumers parsing machine-mode stdout must read the `_tag` field instead of `kind`.
