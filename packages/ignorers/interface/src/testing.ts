import type { NodePath, PlainIgnorer } from './mod.js'
import { validate } from './StandardSchema.js'

export interface IgnorerPathSpec {
  readonly node: unknown
  readonly ancestors?: readonly unknown[] | undefined
}

export interface IgnoredCase {
  readonly name: string
  readonly path: IgnorerPathSpec
  readonly reason: string
}

export interface KeptCase {
  readonly name: string
  readonly path: IgnorerPathSpec
}

export interface IgnoreTesterCases {
  readonly ignored: readonly IgnoredCase[]
  readonly kept: readonly KeptCase[]
}

export interface IgnoreTesterExpectation {
  toBe(expected: unknown): void
  toBeUndefined(): void
}

export type IgnoreTesterDescribe = (name: string, register: () => void) => void
export type IgnoreTesterIt = (name: string, assert: () => void) => void
export type IgnoreTesterExpect = (value: unknown) => IgnoreTesterExpectation

export interface IgnoreTesterStatics {
  describe: IgnoreTesterDescribe | undefined
  it: IgnoreTesterIt | undefined
  expect: IgnoreTesterExpect | undefined
}

export interface IgnoreTesterSurface extends IgnoreTesterStatics {
  run(name: string, ignorer: PlainIgnorer, cases: IgnoreTesterCases): void
}

const DESCRIPTOR_NAME = 'Should_Register_The_Descriptor'

const UNWIRED =
  'IgnoreTester is not wired to a test runner: assign IgnoreTester.describe, .it, and .expect before calling run()'

const checkWired = <T>(candidate: T | undefined): T => {
  if (candidate === undefined) throw new Error(UNWIRED)
  return candidate
}

const ancestorsOfSpec = (spec: IgnorerPathSpec): readonly unknown[] => spec.ancestors ?? []

const buildPath = (spec: IgnorerPathSpec): NodePath => {
  const ancestors = ancestorsOfSpec(spec)
  let parentPath: NodePath | null = null
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    parentPath = { node: ancestors[index], parentPath }
  }
  return { node: spec.node, parentPath }
}

const assertNode = (expect: IgnoreTesterExpect, ignorer: PlainIgnorer, spec: IgnorerPathSpec): void => {
  expect(validate(ignorer.schema, spec.node).issues).toBeUndefined()
}

const registerIgnored = (
  it: IgnoreTesterIt,
  expect: IgnoreTesterExpect,
  ignorer: PlainIgnorer,
  testCase: IgnoredCase,
): void => {
  it(testCase.name, () => {
    assertNode(expect, ignorer, testCase.path)
    expect(ignorer.shouldIgnore(buildPath(testCase.path))).toBe(testCase.reason)
  })
}

const registerKept = (
  it: IgnoreTesterIt,
  expect: IgnoreTesterExpect,
  ignorer: PlainIgnorer,
  testCase: KeptCase,
): void => {
  it(testCase.name, () => {
    assertNode(expect, ignorer, testCase.path)
    expect(ignorer.shouldIgnore(buildPath(testCase.path))).toBeUndefined()
  })
}

export const IgnoreTester: IgnoreTesterSurface = {
  describe: undefined,
  it: undefined,
  expect: undefined,

  run(name, ignorer, cases) {
    const describe = checkWired(IgnoreTester.describe)
    const it = checkWired(IgnoreTester.it)
    const expect = checkWired(IgnoreTester.expect)

    describe(name, () => {
      it(DESCRIPTOR_NAME, () => {
        expect(ignorer.name).toBe(name)
        expect(ignorer.schema['~standard'].version).toBe(1)
        expect(typeof ignorer.schema['~standard'].validate).toBe('function')
      })
      cases.ignored.forEach((ignored) => registerIgnored(it, expect, ignorer, ignored))
      cases.kept.forEach((kept) => registerKept(it, expect, ignorer, kept))
    })
  },
}
