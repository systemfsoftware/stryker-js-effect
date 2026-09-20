import { expect, type MatcherState } from 'vitest'

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
  toMatchVerdict(
    this: MatcherState,
    received: unknown,
    expected: {
      readonly counts: {
        readonly compileErrors: number
        readonly killed: number
        readonly survived: number
        readonly pending?: number
        readonly runtimeErrors?: number
        readonly timeout?: number
      }
      readonly score: number
    },
  ) {
    const options = {
      isNot: this.isNot,
      promise: this.promise ?? '',
    }

    if (typeof received !== 'object' || received === null) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint('toMatchVerdict', undefined, undefined, options) +
          '\n\n' +
          `Expected value to be an object, but received ${this.utils.printReceived(received)}`,
        actual: received,
        expected,
      }
    }

    const counts = Reflect.get(received, 'counts')
    const score = Reflect.get(received, 'score')

    const actualVerdictSummary = {
      counts: typeof counts === 'object' && counts !== null
        ? {
          compileErrors: Reflect.get(counts, 'compileErrors'),
          killed: Reflect.get(counts, 'killed'),
          survived: Reflect.get(counts, 'survived'),
          ...(expected.counts.pending !== undefined ? { pending: Reflect.get(counts, 'pending') } : {}),
          ...(expected.counts.runtimeErrors !== undefined
            ? { runtimeErrors: Reflect.get(counts, 'runtimeErrors') }
            : {}),
          ...(expected.counts.timeout !== undefined ? { timeout: Reflect.get(counts, 'timeout') } : {}),
        }
        : counts,
      score: typeof score === 'number' ? Math.round(score * 100) / 100 : score,
    }

    const expectedVerdictSummary = {
      counts: expected.counts,
      score: Math.round(expected.score * 100) / 100,
    }

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

    const message = (): string => {
      const hint = this.utils.matcherHint('toMatchVerdict', undefined, undefined, options)
      const diff = this.utils.diff(expectedVerdictSummary, actualVerdictSummary)
      return hint + '\n\n' +
        (diff ??
          `Expected: ${this.utils.printExpected(expectedVerdictSummary)}\nReceived: ${
            this.utils.printReceived(actualVerdictSummary)
          }`)
    }

    return {
      pass,
      message,
      actual: actualVerdictSummary,
      expected: expectedVerdictSummary,
    }
  },

  toMatchMutationReport(
    this: MatcherState,
    received: unknown,
    expected: {
      readonly schemaVersion: string
      readonly file: string
      readonly mutants: ReadonlyArray<{ readonly status: string }>
    },
  ) {
    const options = {
      isNot: this.isNot,
      promise: this.promise ?? '',
    }

    if (typeof received !== 'object' || received === null) {
      return {
        pass: false,
        message: () =>
          this.utils.matcherHint('toMatchMutationReport', undefined, undefined, options) +
          '\n\n' +
          `Expected value to be an object, but received ${this.utils.printReceived(received)}`,
        actual: received,
        expected,
      }
    }

    const schemaVersion = Reflect.get(received, 'schemaVersion')
    const files = Reflect.get(received, 'files') as
      | Record<string, { mutants: Record<string, { status: string }> }>
      | undefined
    const fileEntry = files?.[expected.file]

    const actualFileMutants = fileEntry?.mutants
      ? Object.values(fileEntry.mutants).map((m: { status: string }) => ({ status: m.status })).sort(
        (a, b) => a.status.localeCompare(b.status),
      )
      : undefined

    const actualReportSummary = {
      schemaVersion,
      file: expected.file,
      mutants: actualFileMutants,
    }

    const expectedReportSummary = {
      schemaVersion: expected.schemaVersion,
      file: expected.file,
      mutants: [...expected.mutants].sort((a, b) => a.status.localeCompare(b.status)),
    }

    const pass = Boolean(
      schemaVersion === expected.schemaVersion &&
        fileEntry !== undefined &&
        actualFileMutants !== undefined &&
        JSON.stringify(actualFileMutants) === JSON.stringify(expectedReportSummary.mutants),
    )

    const message = (): string => {
      const hint = this.utils.matcherHint('toMatchMutationReport', undefined, undefined, options)
      const diff = this.utils.diff(expectedReportSummary, actualReportSummary)
      return hint + '\n\n' +
        (diff ??
          `Expected: ${this.utils.printExpected(expectedReportSummary)}\nReceived: ${
            this.utils.printReceived(actualReportSummary)
          }`)
    }

    return {
      pass,
      message,
      actual: actualReportSummary,
      expected: expectedReportSummary,
    }
  },
})
