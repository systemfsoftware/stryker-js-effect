import { createRequire } from 'node:module'

import { Drain, Registry } from '@systemfsoftware/stryker-vm-harness'
import { dual } from 'effect/Function'

type EachValue = null | undefined | string | number | boolean | bigint | symbol | object

type TokenFormatter = (args: readonly EachValue[], options?: { readonly truncate?: number }) => string

interface DisplayChunkNamespaceLike {
  readonly format?: TokenFormatter
  readonly f?: TokenFormatter
}

let cachedTokenFormat: TokenFormatter | undefined

const VITEST_PACKAGE_PATH = 'vitest/package.json'

const displayModulePath = (): string => {
  const requireHarness = createRequire(import.meta.url)
  const vitestPackageJson = requireHarness.resolve(VITEST_PACKAGE_PATH)
  const requireVitest = createRequire(vitestPackageJson)
  return requireVitest.resolve('@vitest/utils/display')
}

export const vitestTokenFormat = (): TokenFormatter => {
  const cached = cachedTokenFormat
  if (cached !== undefined) {
    return cached
  }
  const loaded = createRequire(import.meta.url)(displayModulePath()) as DisplayChunkNamespaceLike
  const candidate = loaded.format ?? loaded.f
  if (candidate === undefined) {
    throw new Error('the vitest display bundle no longer exports its token formatter')
  }
  cachedTokenFormat = candidate
  return candidate
}

export interface EachNameSpec {
  readonly template: string
  readonly row: ReadonlyArray<EachValue>
}

const TRUNCATE_BUDGET = 40
const ESCAPED_PERCENT = '__vitest_escaped_%__'

const isObjectItem = (value: EachValue): boolean => value !== null && typeof value === 'object' && !Array.isArray(value)

const negativeNanBuffer = new ArrayBuffer(8)

const isNegativeZeroOrSignedNan = (value: EachValue): boolean => {
  if (typeof value !== 'number') {
    return false
  }
  if (Number.isNaN(value)) {
    const f64 = new Float64Array(negativeNanBuffer)
    f64[0] = value
    const highWord = new Uint32Array(negativeNanBuffer).at(1) ?? 0
    return (highWord >>> 31) === 1
  }
  return Object.is(value, -0)
}

const truncateOf = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }
  let end = maxLength - 1
  const lead = value.at(end - 1) ?? ''
  if (lead >= '\ud800' && lead <= '\udbff') {
    end -= 1
  }
  return `${value.slice(0, end)}…`
}

const attrOf = (source: EachValue, segment: string): EachValue => {
  if (source === null || typeof source !== 'object') {
    return undefined
  }
  return (source as Record<string, EachValue>)[segment]
}

const objectAttrLike = (source: EachValue, path: string, defaultValue?: EachValue): EachValue => {
  const segments = path.replace(/\[(\d+)\]/gu, '.$1').split('.')
  let result: EachValue = source
  for (const segment of segments) {
    result = attrOf(result, segment)
    if (result === undefined) {
      return defaultValue
    }
  }
  return result
}

const formatAttributeLike = (
  format: TokenFormatter,
  items: ReadonlyArray<EachValue>,
  segment: string,
  objectFirst: boolean,
): string =>
  segment.replace(/\$([$\p{ID_Continue}.]+)/gu, (_match: string, key: string): string => {
    const isArrayKey = /^\d+$/u.test(key)
    if (!objectFirst && !isArrayKey) {
      return `$${key}`
    }
    const arrayElement = isArrayKey ? objectAttrLike(items, key) : undefined
    const value = objectFirst ? objectAttrLike(items[0], key, arrayElement) : arrayElement
    if (typeof value === 'string') {
      return truncateOf(value, TRUNCATE_BUDGET)
    }
    return typeof value === 'undefined' ? 'undefined' : format(['%o', value], { truncate: TRUNCATE_BUDGET })
  })

const handleRegexMatchLike = (
  input: string,
  onMatch: (token: string) => void,
  onNonMatch: (segment: string) => void,
): void => {
  let lastIndex = 0
  for (const match of input.matchAll(/%[sdjifoOc%]/gu)) {
    const at: number = match.index
    if (lastIndex < at) {
      onNonMatch(input.slice(lastIndex, at))
    }
    onMatch(match[0])
    lastIndex = at + match[0].length
  }
  if (lastIndex < input.length) {
    onNonMatch(input.slice(lastIndex))
  }
}

export const formatEachNameReference = (spec: EachNameSpec): string => {
  const format = vitestTokenFormat()
  const items = spec.row
  let template = spec.template
  if (template.includes('%#') || template.includes('%$')) {
    template = template
      .replace(/%%/gu, ESCAPED_PERCENT)
      .replace(/%#/gu, '0')
      .replace(/%\$/gu, '1')
      .replace(/__vitest_escaped_%__/gu, '%%')
  }
  const count = template.split('%').length - 1
  if (template.includes('%f')) {
    const floatMatches = template.match(/%f/gu) ?? []
    floatMatches.forEach((_match: string, position: number): void => {
      if (!isNegativeZeroOrSignedNan(items[position])) {
        return
      }
      let occurrence = 0
      template = template.replace(/%f/gu, (token: string): string => {
        occurrence += 1
        return occurrence === position + 1 ? `-${token}` : token
      })
    })
  }
  const objectFirst = isObjectItem(items[0])
  let output = ''
  let consumed = 0
  handleRegexMatchLike(
    template,
    (token) => {
      if (consumed < count) {
        const item = items[consumed]
        consumed += 1
        output += format([token, item], { truncate: TRUNCATE_BUDGET })
        return
      }
      output += token
    },
    (segment) => {
      output += formatAttributeLike(format, items, segment, objectFirst)
    },
  )
  return output
}

export type PlanModeSpec = 'run' | 'skip' | 'only' | 'todo' | 'fails'
export type PlanRowMode = PlanModeSpec | 'op-skip' | 'op-only'

export interface PlanTestSpec {
  readonly name: string
  readonly mode: PlanModeSpec
  readonly suiteSize: number
}

export interface PlanSeedSpec {
  readonly tests: ReadonlyArray<PlanTestSpec>
  readonly prepared: boolean
}

export interface PlanRow {
  readonly key: string
  readonly mode: PlanRowMode
  readonly status: string
}

const NOOP = (): void => {}

interface PlanRowSpec {
  readonly key: string
  readonly mode: PlanRowMode
}

const planRowSpecsOf = (seed: PlanSeedSpec, prepared: boolean): ReadonlyArray<PlanRowSpec> => [
  ...seed.tests.map((spec, index) => ({ key: `plan:${index}:${spec.name}`, mode: spec.mode })),
  ...(prepared
    ? [{ key: 'op:skip-copy', mode: 'op-skip' as const }, { key: 'op:only-probe', mode: 'op-only' as const }]
    : []),
]

const planRegistryOf = (seed: PlanSeedSpec, prepared: boolean): Registry.TestRegistry => {
  const registry = Registry.createRegistry()
  const api = Registry.createHarnessApi(registry)
  seed.tests.forEach((spec: PlanTestSpec): void => {
    if (spec.suiteSize === 0) {
      if (spec.mode === 'todo') {
        api.it.todo(spec.name)
      } else if (spec.mode === 'skip') {
        api.it.skip(spec.name, NOOP)
      } else if (spec.mode === 'only') {
        api.it.only(spec.name, NOOP)
      } else if (spec.mode === 'fails') {
        api.it.fails(spec.name, NOOP)
      } else {
        api.it(spec.name, NOOP)
      }
      return
    }
    if (spec.mode === 'skip') {
      api.describe.skip(`suite for ${spec.name}`, (suiteApi) => suiteApi(spec.name, NOOP))
    } else if (spec.mode === 'only') {
      api.describe.only(`suite for ${spec.name}`, (suiteApi) => suiteApi(spec.name, NOOP))
    } else if (spec.mode === 'todo') {
      api.describe(`suite for ${spec.name}`, (suiteApi) => suiteApi.todo(spec.name))
    } else if (spec.mode === 'fails') {
      api.describe(`suite for ${spec.name}`, (suiteApi) => suiteApi.fails(spec.name, NOOP))
    } else {
      api.describe(`suite for ${spec.name}`, (suiteApi) => suiteApi(spec.name, NOOP))
    }
  })
  if (prepared) {
    api.it.skip('extra skip copy', NOOP)
    api.describe.only('only wrapper', (suiteApi) => suiteApi('only probe', NOOP))
  }
  return registry
}

export const planRowsOf = (seed: PlanSeedSpec): Promise<ReadonlyArray<PlanRow>> => {
  const specs = planRowSpecsOf(seed, seed.prepared)
  return Drain.executeDrainRegistry(planRegistryOf(seed, seed.prepared), 5000).then((outcome) => {
    if (outcome.kind !== 'complete') {
      return specs.map((spec) => ({ key: spec.key, mode: spec.mode, status: 'timeout' }))
    }
    return outcome.tests.map((test, index) => {
      const spec = specs[index]
      return {
        key: spec?.key ?? `missing:${index}`,
        mode: spec?.mode ?? 'run',
        status: test.status,
      }
    })
  })
}

const planStatusFor = (row: PlanRow, onlyPresent: boolean): string => {
  if (onlyPresent) {
    return row.mode === 'only' || row.mode === 'op-only' ? 'success' : 'skipped'
  }
  if (row.mode === 'skip' || row.mode === 'op-skip' || row.mode === 'todo') {
    return 'skipped'
  }
  return row.mode === 'fails' ? 'failed' : 'success'
}

const planHolds = (rows: ReadonlyArray<PlanRow>): boolean => {
  const onlyPresent = rows.some((row) => row.mode === 'only' || row.mode === 'op-only')
  return rows.every((row) => row.status === planStatusFor(row, onlyPresent))
}

export const planRelation = dual<
  (followUp: ReadonlyArray<PlanRow>) => (baseline: ReadonlyArray<PlanRow>) => boolean,
  (baseline: ReadonlyArray<PlanRow>, followUp: ReadonlyArray<PlanRow>) => boolean
>(2, (baseline, followUp) => {
  if (followUp.length !== baseline.length + 2) {
    return false
  }
  for (let index = 0; index < baseline.length; index += 1) {
    if (baseline[index]?.key !== followUp[index]?.key) {
      return false
    }
  }
  const tail = followUp.slice(-2)
  if (tail[0]?.key !== 'op:skip-copy' || tail[1]?.key !== 'op:only-probe') {
    return false
  }
  return planHolds(baseline) && planHolds(followUp)
})

export type DrainModeSpec = 'run' | 'skip' | 'todo' | 'fails'

export interface DrainTestSpec {
  readonly name: string
  readonly mode: DrainModeSpec
}

export interface DrainFileSpec {
  readonly name: string
  readonly tests: ReadonlyArray<DrainTestSpec>
}

export interface DrainSeedSpec {
  readonly files: ReadonlyArray<DrainFileSpec>
}

export interface DrainRow {
  readonly key: string
  readonly fullName: string
  readonly file: string
  readonly status: string
  readonly failureMessage: string | undefined
}

export const DRAIN_RENAMED_FILE = 'renamed-file'

export const drainRenameTargetOf = (seed: DrainSeedSpec): string =>
  seed.files.map((file) => file.name).sort()[0] ?? DRAIN_RENAMED_FILE

export const drainTransform = (seed: DrainSeedSpec): DrainSeedSpec => {
  const target = drainRenameTargetOf(seed)
  return {
    files: seed.files.map((file) => file.name === target ? { ...file, name: DRAIN_RENAMED_FILE } : file),
  }
}

const drainRegistryOf = (seed: DrainSeedSpec): Registry.TestRegistry => {
  const registry = Registry.createRegistry()
  const api = Registry.createHarnessApi(registry)
  seed.files.forEach((file: DrainFileSpec): void => {
    registry.files.current = file.name
    api.describe(file.name, (suiteApi) => {
      file.tests.forEach((test: DrainTestSpec): void => {
        if (test.mode === 'skip') {
          suiteApi.skip(test.name, NOOP)
        } else if (test.mode === 'todo') {
          suiteApi.todo(test.name)
        } else if (test.mode === 'fails') {
          suiteApi.fails(test.name, NOOP)
        } else {
          suiteApi(test.name, NOOP)
        }
      })
    })
  })
  registry.files.current = ''
  return registry
}

interface DrainSeedRow {
  readonly key: string
}

export const drainedRows = (seed: DrainSeedSpec): Promise<ReadonlyArray<DrainRow>> => {
  const seedRows: ReadonlyArray<DrainSeedRow> = seed.files.flatMap((file, fileIndex) =>
    file.tests.map((_test, testIndex) => ({ key: `d:${fileIndex}:${testIndex}` }))
  )
  return Drain.executeDrainRegistry(drainRegistryOf(seed), 5000).then((outcome) => {
    if (outcome.kind !== 'complete') {
      return seedRows.map((row) => ({
        key: row.key,
        fullName: '',
        file: '',
        status: 'timeout',
        failureMessage: undefined,
      }))
    }
    return outcome.tests.map((test, index) => {
      const seedRow = seedRows[index]
      return {
        key: seedRow?.key ?? `missing:${index}`,
        fullName: test.fullName,
        file: test.file,
        status: test.status,
        failureMessage: test.failureMessage,
      }
    })
  })
}

export const drainRelation = dual<
  (followUp: ReadonlyArray<DrainRow>) => (baseline: ReadonlyArray<DrainRow>) => boolean,
  (baseline: ReadonlyArray<DrainRow>, followUp: ReadonlyArray<DrainRow>) => boolean
>(2, (baseline, followUp) => {
  if (baseline.length !== followUp.length) {
    return false
  }
  const timedOut = baseline.some((row) => row.status === 'timeout') || followUp.some((row) => row.status === 'timeout')
  if (timedOut) {
    return baseline.every((row) => row.status === 'timeout') && followUp.every((row) => row.status === 'timeout')
  }
  const sources = new Map(baseline.map((row) => [row.key, row]))
  const renamedSource = [...new Set(baseline.map((row) => row.file))].sort()[0] ?? DRAIN_RENAMED_FILE
  return followUp.every((row) => {
    const source = sources.get(row.key)
    if (source === undefined) {
      return false
    }
    const expectedFile = source.file === renamedSource ? DRAIN_RENAMED_FILE : source.file
    if (row.file !== expectedFile) {
      return false
    }
    const segments = source.fullName.split(' > ')
    if (segments[0] === source.file) {
      segments[0] = expectedFile
    }
    const expectedFullName = segments.join(' > ')
    if (row.fullName !== expectedFullName) {
      return false
    }
    if (row.status !== source.status) {
      return false
    }
    const expectedMessage = source.failureMessage === undefined
      ? undefined
      : source.failureMessage.split(source.fullName).join(expectedFullName)
    return row.failureMessage === expectedMessage
  })
})
