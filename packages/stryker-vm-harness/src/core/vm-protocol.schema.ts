/**
 * The wire contract between the Stryker host process and one harness session.
 *
 * Every value crosses a `worker_threads` structured-clone boundary, so it is
 * plain data. Optional keys use `optionalKey` rather than `optional` because an
 * absent key survives the clone where an explicit `undefined` does not
 * round-trip as expected (SCHEMA-1).
 */

import { Schema as S } from 'effect'

export const VmSessionOptionsSchema = S.Struct({
  sandboxWorkingDirectory: S.String,
  testFiles: S.Array(S.String),
  isolate: S.optionalKey(S.Boolean),
  configFile: S.optionalKey(S.String),
})

export type VmSessionOptions = typeof VmSessionOptionsSchema.Type

export const VmRunKindSchema = S.Literals(['dry', 'mutant'])

export type VmRunKind = typeof VmRunKindSchema.Type

export const VmRunRequestSchema = S.Struct({
  kind: VmRunKindSchema,
  timeoutMs: S.Finite,
  activeMutantId: S.optionalKey(S.String),
  testFilter: S.optionalKey(S.Array(S.String)),
  hitLimit: S.optionalKey(S.Finite),
  reloadEnvironment: S.Boolean,
})

export type VmRunRequest = typeof VmRunRequestSchema.Type

export const VmTestStatusSchema = S.Literals(['success', 'failed', 'skipped'])

export type VmTestStatus = typeof VmTestStatusSchema.Type

export const VmTestResultSchema = S.Struct({
  id: S.String,
  name: S.String,
  status: VmTestStatusSchema,
  failureMessage: S.optionalKey(S.String),
  timeSpentMs: S.Finite,
})

export type VmTestResult = typeof VmTestResultSchema.Type

export const VmMutantCoverageSchema = S.Struct({
  static: S.Record(S.String, S.Finite),
  perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
})

export type VmMutantCoverage = typeof VmMutantCoverageSchema.Type

export const VmRunResponseSchema = S.Union([
  S.Struct({
    status: S.Literal('complete'),
    tests: S.Array(VmTestResultSchema),
    mutantCoverage: S.optionalKey(VmMutantCoverageSchema),
  }),
  S.Struct({ status: S.Literal('timeout') }),
  S.Struct({ status: S.Literal('error'), errorMessage: S.String }),
  S.Struct({ status: S.Literal('init-failed'), message: S.String }),
])

export type VmRunResponse = typeof VmRunResponseSchema.Type

export const VmWorkerRequestSchema = S.Struct({
  id: S.Finite,
  request: VmRunRequestSchema,
})

export type VmWorkerRequest = typeof VmWorkerRequestSchema.Type

export const VmWorkerResponseSchema = S.Struct({
  id: S.Finite,
  response: VmRunResponseSchema,
})

export type VmWorkerResponse = typeof VmWorkerResponseSchema.Type
