/**
 * Resolved Vitest configuration, as the in-memory `vm` runner consumes it.
 *
 * The transform host thread resolves the user's Vitest config once per session
 * and reports it in this shape. Everything here crosses a `worker_threads`
 * structured-clone boundary and is read by plugins that must not know Vitest's
 * own types, so it is plain data: no functions, no `RegExp` instances, no
 * `undefined` in present keys — regex-carrying keys (alias `find`,
 * `testNamePattern`) travel as their `source` and `flags`, and the optional
 * keys are declared with `optionalKey` (SCHEMA-1).
 *
 * Non-obvious shape decisions: project `setupFiles` are absolute paths;
 * project `define` keeps Vitest's dotted keys (`process.env.NODE_ENV`,
 * `import.meta.env.VITE_X`) exactly as resolved; project `env` carries the
 * flat string values `import.meta.env` is built from; `browser` is the
 * refusal flag — the `vm` runner cannot serve browser mode and the session
 * fails init with a message naming `testRunner: 'vitest'`.
 */

import { Schema as S } from 'effect'

/** A Vite alias `find`: a literal prefix, or a regex reduced to source + flags. */
export const VmAliasFindSchema = S.Union([
  S.String,
  S.Struct({ source: S.String, flags: S.String }),
])

export type VmAliasFind = typeof VmAliasFindSchema.Type

export const VmAliasSchema = S.Struct({
  find: VmAliasFindSchema,
  replacement: S.String,
})

export type VmAlias = typeof VmAliasSchema.Type

export const VmExpectConfigSchema = S.Struct({
  requireAssertions: S.Boolean,
  poll: S.Struct({ timeout: S.Finite, interval: S.Finite }),
})

export type VmExpectConfig = typeof VmExpectConfigSchema.Type

const JsonRecord = S.Record(S.String, S.Json)

export const VmTagDefinitionSchema = S.Struct({
  name: S.String,
  description: S.optionalKey(S.String),
  options: JsonRecord,
})

export type VmTagDefinition = typeof VmTagDefinitionSchema.Type

export const VmProjectConfigSchema = S.Struct({
  name: S.String,
  root: S.String,
  include: S.Array(S.String),
  exclude: S.Array(S.String),
  includeSource: S.Array(S.String),
  setupFiles: S.Array(S.String),
  globals: S.Boolean,
  environment: S.String,
  environmentOptions: JsonRecord,
  isolate: S.Boolean,
  testTimeout: S.Finite,
  hookTimeout: S.Finite,
  retry: S.Finite,
  repeats: S.optionalKey(S.Finite),
  maxConcurrency: S.Finite,
  restoreMocks: S.Boolean,
  clearMocks: S.Boolean,
  mockReset: S.Boolean,
  unstubGlobals: S.Boolean,
  unstubEnvs: S.Boolean,
  snapshotFormat: JsonRecord,
  snapshotSerializers: S.Array(S.String),
  fakeTimers: JsonRecord,
  expect: VmExpectConfigSchema,
  define: JsonRecord,
  env: S.Record(S.String, S.String),
  alias: S.Array(VmAliasSchema),
  conditions: S.Array(S.String),
  testNamePattern: S.optionalKey(S.Struct({ source: S.String, flags: S.String })),
  globalSetup: S.optionalKey(S.Array(S.String)),
  injectCjsGlobals: S.optionalKey(S.Boolean),
  tags: S.optionalKey(S.Array(VmTagDefinitionSchema)),
  strictTags: S.optionalKey(S.Boolean),
  sequence: S.Struct({
    concurrent: S.Boolean,
    shuffle: S.Boolean,
    seed: S.optionalKey(S.Finite),
    hooks: S.Union([S.Literal('stack'), S.Literal('list'), S.Literal('parallel')]),
    setupFiles: S.Union([S.Literal('list'), S.Literal('parallel')]),
  }),
  allowOnly: S.optionalKey(S.Boolean),
  passWithNoTests: S.optionalKey(S.Boolean),
  provide: S.optionalKey(JsonRecord),
})

export type VmProjectConfig = typeof VmProjectConfigSchema.Type

export const VmVitestConfigSchema = S.Struct({
  configFile: S.optionalKey(S.String),
  browser: S.Boolean,
  projects: S.Array(VmProjectConfigSchema),
})

export type VmVitestConfig = typeof VmVitestConfigSchema.Type
