---
"@systemfsoftware/stryker-js": patch
"@systemfsoftware/stryker-js-vitest-runner": patch
"@systemfsoftware/stryker-js-typescript-checker": patch
"@systemfsoftware/stryker-js-instrumenter": patch
"@systemfsoftware/stryker-js-plugin-interface": patch
"@systemfsoftware/stryker-js-plugin-runtime": patch
"@systemfsoftware/stryker-js-cli-contract": patch
"@systemfsoftware/stryker-js-html-reporter": patch
---

Build on effect 4.1.0. effect 4.1.0 removed the `effect/Crypto` module, which the published stryker-js and stryker-js-vitest-runner imported, so a mutation run on effect 4.1.0 failed with ERR_MODULE_NOT_FOUND. Both packages now take random identifiers from `effect/crypto/SecureRandom` (`NodeCrypto.layerSecureRandom`), and the effect peer range is now `^4.1.0`: `effect/crypto/*` does not exist in 4.0.x. Schema classes are branded as @effect/tsgo 0.63.0 requires, the MCP server registers its toolkit through the stdio transport's `registrations` option with a middleware that provides the engine services to each request, and file identity in the case-sensitivity probe is a bigint, as effect 4.1.0 reports it.
