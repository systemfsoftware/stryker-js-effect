import { type HarnessTestContext, hooksFor, planRun, type TestRegistry } from './registry.js'

export type DrainedStatus = 'success' | 'failed' | 'skipped'

export interface DrainedTest {
  readonly fullName: string
  readonly file: string
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
  readonly timeSpentMs: number
}

export type DrainOutcome =
  | { readonly kind: 'complete'; readonly tests: ReadonlyArray<DrainedTest> }
  | { readonly kind: 'timeout' }

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

export const drainRegistry = async (registry: TestRegistry, timeoutMs: number | undefined): Promise<DrainOutcome> => {
  const plan = planRun(registry)
  const tests: DrainedTest[] = []

  const runnableCounts = new Map<number, number>()
  for (const planned of plan) {
    if (planned.skipped) {
      continue
    }
    for (const id of planned.chain) {
      runnableCounts.set(id, (runnableCounts.get(id) ?? 0) + 1)
    }
  }

  const lastRunnable = [...plan].reverse().find((planned) => !planned.skipped)
  const lastRunnableIndex = lastRunnable === undefined ? -1 : lastRunnable.index

  const firedBeforeAll = new Set<number | null>()
  const fireBeforeAll = async (chain: readonly number[], context: HarnessTestContext): Promise<void> => {
    if (!firedBeforeAll.has(null)) {
      firedBeforeAll.add(null)
      for (const hook of registry.rootHooks.beforeAll) {
        await hook(context)
      }
    }
    for (const id of chain) {
      if (firedBeforeAll.has(id)) {
        continue
      }
      firedBeforeAll.add(id)
      for (const hook of hooksFor(registry, 'beforeAll', [id])) {
        await hook(context)
      }
    }
  }

  const fireAfterAll = async (id: number | null, context: HarnessTestContext): Promise<void> => {
    if (id === null) {
      for (const hook of [...registry.rootHooks.afterAll].reverse()) {
        await hook(context)
      }
      return
    }
    const remaining = (runnableCounts.get(id) ?? 0) - 1
    runnableCounts.set(id, remaining)
    if (remaining > 0) {
      return
    }
    for (const hook of hooksFor(registry, 'afterAll', [id])) {
      await hook(context)
    }
  }

  const lateRejections: string[] = []
  const rejectionListener = (cause: unknown): void => {
    lateRejections.push(messageOf(cause))
  }
  process.on('unhandledRejection', rejectionListener)

  let timedOut = false
  const timer = timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
      timedOut = true
    }, timeoutMs)
  timer?.unref?.()

  try {
    for (const planned of plan) {
      if (planned.skipped) {
        tests.push({
          fullName: planned.fullName,
          file: planned.test.file,
          status: 'skipped',
          failureMessage: undefined,
          timeSpentMs: 0,
        })
        continue
      }
      if (timedOut) {
        return { kind: 'timeout' }
      }
      const controller = new AbortController()
      const finalizers: Array<(context: HarnessTestContext) => unknown> = []
      const context: HarnessTestContext = {
        signal: controller.signal,
        task: { type: 'test', name: planned.fullName },
        onTestFinished: (finalizer) => {
          finalizers.push(finalizer)
        },
      }

      await fireBeforeAll(planned.chain, context)
      for (const hook of hooksFor(registry, 'beforeEach', planned.chain)) {
        await hook(context)
      }

      const startedAt = performance.now()
      let failureMessage: string | undefined
      if (planned.test.fn === undefined) {
        failureMessage = 'Test has no function body'
      } else {
        const invoked = Promise.resolve()
          .then(() => planned.test.fn?.(context))
          .then(
            () => undefined,
            (cause: unknown) => ({ cause }),
          )
        void invoked.catch(() => {})
        const settled = await invoked
        failureMessage = settled === undefined ? undefined : messageOf(settled.cause)
      }
      const timeSpentMs = performance.now() - startedAt

      for (const hook of [...hooksFor(registry, 'afterEach', planned.chain)].reverse()) {
        await hook(context)
      }
      for (const finalizer of [...finalizers].reverse()) {
        await finalizer(context)
      }
      for (const id of [...planned.chain].reverse()) {
        await fireAfterAll(id, context)
      }
      if (planned.index === lastRunnableIndex) {
        await fireAfterAll(null, context)
      }

      const threw = failureMessage !== undefined
      const status: DrainedStatus = threw === planned.test.inverted ? 'success' : 'failed'
      const message = threw
        ? failureMessage
        : planned.test.inverted
        ? `${planned.fullName} was expected to fail, but passed`
        : undefined
      tests.push({
        fullName: planned.fullName,
        file: planned.test.file,
        status,
        failureMessage: message,
        timeSpentMs,
      })
    }
    if (timedOut) {
      return { kind: 'timeout' }
    }
  } finally {
    clearTimeout(timer)
    process.off('unhandledRejection', rejectionListener)
  }

  if (lateRejections.length > 0) {
    tests.push({
      fullName: 'unhandled rejection',
      file: '',
      status: 'failed',
      failureMessage: lateRejections.join('\n'),
      timeSpentMs: 0,
    })
  }
  return { kind: 'complete', tests }
}
