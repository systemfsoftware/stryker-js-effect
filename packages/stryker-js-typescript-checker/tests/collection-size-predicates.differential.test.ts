import { Differential } from '@systemfsoftware/differential-spec'
import * as Effect from 'effect/Effect'
import * as fc from 'fast-check'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { API, SymbolFlags, TypeFlags } from 'typescript/unstable/sync'

const TSCONFIG = '/collection-size/tsconfig.json'
const FILE = '/collection-size/facts.ts'
const TSCONFIG_TEXT = JSON.stringify({
  compilerOptions: { noEmit: true, target: 'es2022', module: 'esnext', strict: true, types: [] },
})

const BLOCKS: ReadonlyArray<string> = [
  'type Tuple = [string, ...string[]]\ndeclare const tuple: Tuple',
  'type Arr = string[]\ndeclare const arr: Arr',
  'type Ro = readonly string[]\ndeclare const ro: Ro',
  'declare const str: string',
  'declare class Holder {\n  get accessor(): string\n  plain: string\n}',
]

interface Facts {
  readonly tupleIsTuple: boolean
  readonly arrayIsTuple: boolean
  readonly arrayIsArray: boolean
  readonly readonlyIsArray: boolean
  readonly stringIsStringLike: boolean
  readonly accessorIsAccessor: boolean
  readonly plainIsAccessor: boolean
}

const EXPECTED: Facts = {
  tupleIsTuple: true,
  arrayIsTuple: false,
  arrayIsArray: true,
  readonlyIsArray: true,
  stringIsStringLike: true,
  accessorIsAccessor: true,
  plainIsAccessor: false,
}

const factsOf = (source: string): Facts => {
  const api = new API({ fs: createVirtualFileSystem({ [TSCONFIG]: TSCONFIG_TEXT, [FILE]: source }) })
  try {
    const project = api.updateSnapshot({ openProjects: [TSCONFIG] }).getProject(TSCONFIG)
    if (project === undefined) {
      throw new Error('the tsgo program has no project for the fixture tsconfig')
    }
    const checker = project.checker
    const typeAt = (needle: string) => {
      const type = checker.getTypeAtPosition(FILE, source.indexOf(needle))
      if (type === undefined) {
        throw new Error(`no type at ${needle}`)
      }
      return type
    }
    const symbolAt = (needle: string) => {
      const symbol = checker.getSymbolAtPosition(FILE, source.indexOf(needle))
      if (symbol === undefined) {
        throw new Error(`no symbol at ${needle}`)
      }
      return symbol
    }
    const tuple = typeAt('tuple:')
    const arr = typeAt('arr:')
    const ro = typeAt('ro:')
    const str = typeAt('str:')
    const accessor = symbolAt('accessor')
    const plain = symbolAt('plain')
    return {
      tupleIsTuple: checker.isTupleType(tuple),
      arrayIsTuple: checker.isTupleType(arr),
      arrayIsArray: checker.isArrayType(arr),
      readonlyIsArray: checker.isArrayType(ro),
      stringIsStringLike: (str.flags & TypeFlags.StringLike) !== 0,
      accessorIsAccessor: (accessor.flags & SymbolFlags.Accessor) !== 0,
      plainIsAccessor: (plain.flags & SymbolFlags.Accessor) !== 0,
    }
  } finally {
    api.close()
  }
}

const sameFacts = (expected: Facts, actual: Facts): boolean =>
  expected.tupleIsTuple === actual.tupleIsTuple &&
  expected.arrayIsTuple === actual.arrayIsTuple &&
  expected.arrayIsArray === actual.arrayIsArray &&
  expected.readonlyIsArray === actual.readonlyIsArray &&
  expected.stringIsStringLike === actual.stringIsStringLike &&
  expected.accessorIsAccessor === actual.accessorIsAccessor &&
  expected.plainIsAccessor === actual.plainIsAccessor

const sources: fc.Arbitrary<string> = fc
  .shuffledSubarray([...BLOCKS], { minLength: BLOCKS.length })
  .map((blocks) => blocks.join('\n'))

Differential.compare({
  name: 'collection-size: the checker facts the rule reads hold for every declaration order',
  reference: () => Effect.succeed(EXPECTED),
  candidate: (source: string) => Effect.sync(() => factsOf(source)),
})
  .on(sources, {
    runBudget: 4,
    hostBound: {
      timeout: 120_000,
      reason: 'the candidate builds a real tsgo program through the TypeScript 7 sync API',
    },
  })
  .assert(sameFacts)
