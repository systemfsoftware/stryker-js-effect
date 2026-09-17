---
"@systemfsoftware/stryker-js-engine": major
---

Removed the base option preset subpath. It pinned a fixed plugin and reporter list that predates the current contract where your config's `plugins` array is the sole source of what loads, and nothing in the supported setup imported it.

To migrate, write the options you used from the preset directly in your `stryker.config.ts` instead of importing it.
