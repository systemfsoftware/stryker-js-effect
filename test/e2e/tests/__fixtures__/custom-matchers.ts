import { expect } from 'vitest'

interface CustomMatchers<R = unknown> {
  toMatchVerdict(expected: {
    readonly counts: {
      readonly compileErrors: number
      readonly killed: number
      readonly survived: number
      readonly pending?: number
      readonly runtimeErrors?: number
      readonly timeout?: number
    }
    readonly score: number
  }): R
  toMatchMutationReport(expected: {
    readonly schemaVersion: string
    readonly file: string
    readonly mutants: ReadonlyArray<{ readonly status: string }>
  }): R
}

interface CustomAsymmetricMatchers {
  toMatchVerdict(expected: {
    readonly counts: {
      readonly compileErrors: number
      readonly killed: number
      readonly survived: number
      readonly pending?: number
      readonly runtimeErrors?: number
      readonly timeout?: number
    }
    readonly score: number
  }): unknown
  toMatchMutationReport(expected: {
    readonly schemaVersion: string
    readonly file: string
    readonly mutants: ReadonlyArray<{ readonly status: string }>
  }): unknown
}

declare module 'vitest' {
  interface Assertion extends CustomMatchers {}
  interface AsymmetricMatchersContaining extends CustomAsymmetricMatchers {}
}

expect.extend({
  toMatchVerdict(received: unknown, expected) {
    const isObject = typeof received === 'object' && received !== null
    if (!isObject) {
      return {
        pass: false,
        message: () => `expected verdict object, received ${typeof received}`,
      }
    }

    const counts = Reflect.get(received, 'counts')
    const score = Reflect.get(received, 'score')

    const countsPass = typeof counts === 'object' &&
      counts !== null &&
      Reflect.get(counts, 'compileErrors') === expected.counts.compileErrors &&
      Reflect.get(counts, 'killed') === expected.counts.killed &&
      Reflect.get(counts, 'survived') === expected.counts.survived &&
      (expected.counts.pending === undefined || Reflect.get(counts, 'pending') === expected.counts.pending) &&
      (expected.counts.runtimeErrors === undefined ||
        Reflect.get(counts, 'runtimeErrors') === expected.counts.runtimeErrors) &&
      (expected.counts.timeout === undefined || Reflect.get(counts, 'timeout') === expected.counts.timeout)

    const scorePass = typeof score === 'number' && Math.abs(score - expected.score) < 0.1

    const pass = Boolean(countsPass && scorePass)
    return {
      pass,
      message: () =>
        pass
          ? `expected verdict not to match counts ${JSON.stringify(expected.counts)} and score ${expected.score}`
          : `verdict mismatch:\nreceived: counts=${JSON.stringify(counts)}, score=${score}\nexpected: counts=${
            JSON.stringify(expected.counts)
          }, score=${expected.score}`,
      actual: received,
      expected,
    }
  },

  toMatchMutationReport(received: unknown, expected) {
    const isObject = typeof received === 'object' && received !== null
    if (!isObject) {
      return {
        pass: false,
        message: () => `expected report object, received ${typeof received}`,
      }
    }

    const schemaVersion = Reflect.get(received, 'schemaVersion')
    const files = Reflect.get(received, 'files') as
      | Record<string, { mutants: Record<string, { status: string }> }>
      | undefined
    const fileEntry = files?.[expected.file]

    const versionPass = schemaVersion === expected.schemaVersion
    const filePass = fileEntry !== undefined

    if (!versionPass || !filePass || !fileEntry.mutants) {
      return {
        pass: false,
        message: () => `report structure mismatch: schemaVersion=${schemaVersion}, filePresent=${filePass}`,
        actual: received,
        expected,
      }
    }

    const mutants = Object.values(fileEntry.mutants as Record<string, { status: string }>)
    const expectedStatuses = expected.mutants.map((m: { status: string }) => m.status).sort()
    const receivedStatuses = mutants.map((m: { status: string }) => m.status).sort()

    const mutantsPass = JSON.stringify(receivedStatuses) === JSON.stringify(expectedStatuses)

    return {
      pass: mutantsPass,
      message: () =>
        mutantsPass
          ? `expected report not to match mutant statuses: ${JSON.stringify(expectedStatuses)}`
          : `mutant statuses mismatch:\nreceived: ${JSON.stringify(receivedStatuses)}\nexpected: ${
            JSON.stringify(expectedStatuses)
          }`,
      actual: receivedStatuses,
      expected: expectedStatuses,
    }
  },
})
