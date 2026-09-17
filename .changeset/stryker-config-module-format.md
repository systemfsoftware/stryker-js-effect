---
"@systemfsoftware/stryker-js-cli": major
"@systemfsoftware/stryker-js-engine": major
---

Configuration is now a TypeScript or ECMAScript module — `stryker.config.ts`, `.mts`, `.js`, `.mjs`, or their `stryker.conf.*` twins — default-exporting the options object, and `--configFile` accepts only those extensions. JSON and CommonJS configs are no longer read: when one exists with no supported config file present, the run exits with the config error class naming the file and the supported extensions instead of running on defaults. `.ts`/`.mts` load through native type stripping, so a config must be erasable syntax — no `enum`, runtime `namespace`, parameter properties, or decorators. Node.js 22.18.0 or later is required (`>=22.18.0`).

To migrate, rename the file and convert the JSON object to a default export. From:

```jsonc
{
  "testRunner": "vitest",
  "mutate": ["src/**/*.ts"]
}
```

to:

```ts
export default {
  testRunner: 'vitest',
  mutate: ['src/**/*.ts'],
}
```
