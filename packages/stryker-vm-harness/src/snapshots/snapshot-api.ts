import { TestRunner } from 'vitest'

import type { Json } from 'effect/Schema'
import type { SnapshotUpdateMode } from '../snapshot-paths.js'

export interface SnapshotStackFrame {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly method?: string
}

export interface SnapshotEnvironmentLike {
  readonly getVersion: () => string
  readonly getHeader: () => string
  readonly resolvePath: (filepath: string) => Promise<string> | string
  readonly resolveRawPath: (testPath: string, rawPath: string) => Promise<string> | string
  readonly readSnapshotFile: (filepath: string) => Promise<string | null>
  readonly saveSnapshotFile: (filepath: string, snapshot: string) => Promise<void>
  readonly removeSnapshotFile: (filepath: string) => Promise<void>
  readonly processStackTrace?: (stack: SnapshotStackFrame) => SnapshotStackFrame
}

export interface SnapshotStateOptionsLike {
  readonly updateSnapshot: SnapshotUpdateMode | 'all'
  readonly snapshotEnvironment: SnapshotEnvironmentLike
  readonly snapshotFormat: SnapshotFormatLike
  readonly expand?: boolean
}

export interface SnapshotSummaryLike {
  readonly added: number
  readonly matched: number
  readonly unmatched: number
  readonly updated: number
  readonly unchecked: number
  readonly uncheckedKeys: ReadonlyArray<string>
  readonly fileDeleted: boolean
}

export interface FormatConfig {
  readonly plugins: ReadonlyArray<SerializerPlugin>
}

export type PluginPrinter = (
  value: object,
  config: FormatConfig,
  indentation: string,
  depth: number,
  refs: ReadonlyArray<object>,
) => string

export interface SerializeSerializer {
  readonly test: (value: object) => boolean
  readonly serialize: (
    value: object,
    config: FormatConfig,
    indentation: string,
    depth: number,
    refs: ReadonlyArray<object>,
    printer: PluginPrinter,
  ) => string
}

export interface PrintSerializer {
  readonly test: (value: object) => boolean
  readonly print: (
    value: object,
    serialize: (value: object) => string,
    indent: (value: string) => string,
  ) => string
}
export type SerializerPlugin = SerializeSerializer | PrintSerializer | PrintableSerializerPlugin

export type SnapshotFormatLike = Readonly<Record<string, Json | ReadonlyArray<SerializerPlugin>>>
export interface SnapshotClientMatchOptions {
  readonly filepath: string
  readonly name: string
  readonly received: object
}

export interface PrintableSerializerPlugin {
  readonly test: (value: object) => boolean
  readonly print: (
    value: object,
    serialize: (value: object) => string,
    indent: (value: string) => string,
  ) => string
  readonly serialize?: never
}

export interface SnapshotClientLike {
  readonly setup: (filepath: string, options: SnapshotStateOptionsLike) => Promise<void>
  readonly finish: (filepath: string) => Promise<SnapshotSummaryLike>
  readonly clearTest: (filepath: string, testId: string) => void
  readonly match: (options: SnapshotClientMatchOptions) => object
}

interface TestRunnerInstanceLike {
  readonly snapshotClient: SnapshotClientLike
}

interface TestRunnerConstructorLike {
  new(config: { readonly experimental: { readonly viteModuleRunner: boolean } }): TestRunnerInstanceLike
}

interface VitestWorkerStateLike {
  ctx: { readonly pool: string }
  environment: { readonly name: string }
  onCleanup: (listener: () => void) => void
  filepath?: string
}

const WORKER_STATE_KEY = '__vitest_worker__'

type AnyDecoded<A = unknown> = A

const isTestRunnerConstructor = (value: unknown): value is TestRunnerConstructorLike => typeof value === 'function'

const isObjectLike = (value: unknown): value is object => typeof value === 'object' && value !== null

const hasWorkerStateKeys = (value: object): boolean => 'ctx' in value && 'environment' in value

const isWorkerState = (value: unknown): value is VitestWorkerStateLike =>
  isObjectLike(value) && hasWorkerStateKeys(value)

const workerState = (): VitestWorkerStateLike | undefined => {
  const candidate: AnyDecoded = Reflect.get(globalThis, WORKER_STATE_KEY)
  return isWorkerState(candidate) ? candidate : undefined
}

export const ensureVitestWorkerState = (): void => {
  if (workerState() === undefined) {
    Reflect.set(globalThis, WORKER_STATE_KEY, {
      ctx: { pool: 'threads' },
      environment: { name: 'node' },
      onCleanup: () => {},
    })
  }
}

export const setWorkerTestFile = (file: string): void => {
  const state = workerState()
  if (state !== undefined) {
    state.filepath = file
  }
}

export const snapshotClientOf = (): SnapshotClientLike => {
  ensureVitestWorkerState()
  if (!isTestRunnerConstructor(TestRunner)) {
    throw new Error("The resolved 'vitest' module does not export a TestRunner constructor.")
  }
  return new TestRunner({ experimental: { viteModuleRunner: false } }).snapshotClient
}
