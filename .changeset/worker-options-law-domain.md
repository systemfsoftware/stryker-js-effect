---
"@systemfsoftware/stryker-js-plugin-runtime": none
---

`WorkerOptionsWire` gained an internal declaration so its round-trip law suite draws option keys that the JSON parser reads back unchanged on V8 13.6 (Node 24 and 26). Decoding and encoding worker options are unchanged, and every exported name, type and runtime behaviour is identical, so no release is warranted.
