---
"@systemfsoftware/stryker-js": patch
---

Installing `@systemfsoftware/stryker-js` on its own now works. `effect` was declared an optional peer even though Stryker imports it at runtime. Package managers never install optional peers, so a project without `effect` failed with `Failed to read config` before the run started. `effect` is now a required peer: pnpm and npm install it automatically, and a project that already uses Effect shares its own copy with Stryker.
