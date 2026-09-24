import { type VmMutantCoverage } from './vm-protocol.schema.js'

const NAMESPACE_KEY = '__stryker__'
const ACTIVE_MUTANT_KEY = 'activeMutant'
const HIT_COUNT_KEY = 'hitCount'
const HIT_LIMIT_KEY = 'hitLimit'
const MUTATION_COVERAGE_KEY = 'mutantCoverage'
const CURRENT_TEST_ID_KEY = 'currentTestId'

type NamespaceValue = boolean | number | string | VmMutantCoverage | undefined

export type StrykerNamespace = Record<string, NamespaceValue>

const descriptorValue = <A = unknown>(descriptor: TypedPropertyDescriptor<A> | undefined): A | undefined =>
  descriptor === undefined ? undefined : descriptor.value

const isPlainObject = <A = unknown>(value: unknown): value is Record<string, A> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const hostStrykerNamespace = (): StrykerNamespace => {
  const current = descriptorValue<StrykerNamespace>(
    Object.getOwnPropertyDescriptor(globalThis, NAMESPACE_KEY),
  )
  if (isPlainObject<StrykerNamespace>(current)) {
    return current
  }
  const created: StrykerNamespace = {}
  Object.defineProperty(globalThis, NAMESPACE_KEY, {
    configurable: true,
    enumerable: true,
    value: created,
    writable: true,
  })
  return created
}

export interface ArmedMutant {
  readonly activeMutantId: string | undefined
  readonly hitCount: number | undefined
  readonly hitLimit: number | undefined
  readonly currentTestId: string | undefined
}

export const readArmedMutant = (namespace: StrykerNamespace): ArmedMutant => ({
  activeMutantId: asString(namespace[ACTIVE_MUTANT_KEY]),
  hitCount: asNumber(namespace[HIT_COUNT_KEY]),
  hitLimit: asNumber(namespace[HIT_LIMIT_KEY]),
  currentTestId: asString(namespace[CURRENT_TEST_ID_KEY]),
})

export const writeArmedMutant = (namespace: StrykerNamespace, state: ArmedMutant): void => {
  namespace[ACTIVE_MUTANT_KEY] = state.activeMutantId
  namespace[HIT_COUNT_KEY] = state.hitCount
  namespace[HIT_LIMIT_KEY] = state.hitLimit
  namespace[CURRENT_TEST_ID_KEY] = state.currentTestId
}

const asString = (value: NamespaceValue): string | undefined => (typeof value === 'string' ? value : undefined)

const asNumber = (value: NamespaceValue): number | undefined => (typeof value === 'number' ? value : undefined)

export const armMutant = (
  namespace: StrykerNamespace,
  activeMutantId: string | undefined,
  hitLimit: number | undefined,
): void => {
  namespace[ACTIVE_MUTANT_KEY] = activeMutantId
  if (activeMutantId === undefined) {
    namespace[HIT_COUNT_KEY] = undefined
    namespace[HIT_LIMIT_KEY] = undefined
    return
  }
  namespace[HIT_COUNT_KEY] = 0
  namespace[HIT_LIMIT_KEY] = hitLimit
}

export const setCurrentTestId = (namespace: StrykerNamespace, testId: string | undefined): void => {
  namespace[CURRENT_TEST_ID_KEY] = testId
}

const isCoverage = (value: NamespaceValue): value is VmMutantCoverage =>
  isPlainObject(value) && isPlainObject(value.static) && isPlainObject(value.perTest)

export const resetMutantCoverage = (namespace: StrykerNamespace): void => {
  const existing = namespace[MUTATION_COVERAGE_KEY]
  if (isCoverage(existing)) {
    const mutable = existing as { -readonly [K in keyof VmMutantCoverage]: VmMutantCoverage[K] }
    mutable.static = {}
    mutable.perTest = {}
    return
  }
  namespace[MUTATION_COVERAGE_KEY] = { perTest: {}, static: {} }
}

export const readMutantCoverage = (namespace: StrykerNamespace): VmMutantCoverage | undefined => {
  const coverage = namespace[MUTATION_COVERAGE_KEY]
  if (!isCoverage(coverage)) {
    return undefined
  }
  const perTest: Record<string, Record<string, number>> = {}
  for (const [testId, hits] of Object.entries(coverage.perTest)) {
    if (isPlainObject<number>(hits)) {
      perTest[testId] = { ...hits }
    }
  }
  return { perTest, static: { ...coverage.static } }
}
