export type MutatorName = 'AtomicUpdateSplit' | 'SynchronizationRemoval' | 'FinalizerEscape'

export type Module = 'Effect' | 'Ref' | 'Semaphore' | 'SynchronizedRef'

export type Form =
  | 'data-first'
  | 'data-last-pipe-arg'
  | 'data-last-pipe-method'
  | 'data-last-immediate'
  | 'data-last-outside-pipe'

export type ScenarioKind =
  | 'equivalence-success'
  | 'equivalence-failure'
  | 'equivalence-partial-matching'
  | 'equivalence-partial-non-matching'
  | 'divergence-two-fibers'
  | 'divergence-max-concurrency'
  | 'divergence-interrupt-region'
  | 'divergence-interrupt-finalizer'
  | 'divergence-interrupt-handler'
  | 'divergence-interrupt-acquire'
  | 'divergence-interrupt-use'

export interface ShapeEntry {
  readonly mutator: MutatorName
  readonly module: Module
  readonly operation: string
  readonly form: Form
  readonly file: string
  readonly exportName: string
  readonly expectedMutants: number
  readonly scenarios: readonly ScenarioKind[]
}

const shape = (
  mutator: MutatorName,
  module: Module,
  operation: string,
  form: Form,
  file: string,
  exportName: string,
  expectedMutants: number,
  scenarios: readonly ScenarioKind[],
): ShapeEntry => ({ mutator, module, operation, form, file, exportName, expectedMutants, scenarios })

const ATOMIC = 'effect-concurrency/atomic-update-split.ts'
const SYNC_REMOVAL = 'effect-concurrency/synchronization-removal.ts'
const FINALIZER = 'effect-concurrency/finalizer-escape.ts'
const REFUSALS = 'effect-concurrency/refusals.ts'

const refKinds: readonly ScenarioKind[] = ['equivalence-success', 'equivalence-failure', 'divergence-two-fibers']

const partialKinds: readonly ScenarioKind[] = [
  'equivalence-partial-matching',
  'equivalence-partial-non-matching',
  'divergence-two-fibers',
]

const semaphoreKinds: readonly ScenarioKind[] = [
  'equivalence-success',
  'equivalence-failure',
  'divergence-max-concurrency',
]

const regionKinds: readonly ScenarioKind[] = [
  'equivalence-success',
  'equivalence-failure',
  'divergence-interrupt-region',
]

const finalizerKinds: readonly ScenarioKind[] = [
  'equivalence-success',
  'equivalence-failure',
  'divergence-interrupt-finalizer',
]

const handlerKinds: readonly ScenarioKind[] = [
  'equivalence-success',
  'equivalence-failure',
  'divergence-interrupt-handler',
]

const bracketKinds: readonly ScenarioKind[] = ['equivalence-success', 'equivalence-failure']

const noScenarios: readonly ScenarioKind[] = []

const refOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('AtomicUpdateSplit', 'Ref', operation, form, ATOMIC, exportName, 1, refKinds)

const refPartialOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('AtomicUpdateSplit', 'Ref', operation, form, ATOMIC, exportName, 1, partialKinds)

const syncOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('AtomicUpdateSplit', 'SynchronizedRef', operation, form, ATOMIC, exportName, 1, refKinds)

const syncPartialOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('AtomicUpdateSplit', 'SynchronizedRef', operation, form, ATOMIC, exportName, 1, partialKinds)

const semaphoreOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('SynchronizationRemoval', 'Semaphore', operation, form, SYNC_REMOVAL, exportName, 1, semaphoreKinds)

const regionOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('SynchronizationRemoval', 'Effect', operation, form, SYNC_REMOVAL, exportName, 1, regionKinds)

const finalizerOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('FinalizerEscape', 'Effect', operation, form, FINALIZER, exportName, 1, finalizerKinds)

const handlerOp = (operation: string, form: Form, exportName: string): ShapeEntry =>
  shape('FinalizerEscape', 'Effect', operation, form, FINALIZER, exportName, 1, handlerKinds)

export const shapes: readonly ShapeEntry[] = [
  refOp('modify', 'data-first', 'refModifyDataFirst'),
  refOp('modify', 'data-last-pipe-arg', 'refModifyPipeArg'),
  refOp('modify', 'data-last-pipe-method', 'refModifyPipeMethod'),
  refPartialOp('modifySome', 'data-first', 'refModifySomeDataFirst'),
  refPartialOp('modifySome', 'data-last-pipe-arg', 'refModifySomePipeArg'),
  refPartialOp('modifySome', 'data-last-pipe-method', 'refModifySomePipeMethod'),
  refOp('update', 'data-first', 'refUpdateDataFirst'),
  refOp('update', 'data-last-pipe-arg', 'refUpdatePipeArg'),
  refOp('update', 'data-last-pipe-method', 'refUpdatePipeMethod'),
  refOp('update', 'data-last-immediate', 'refUpdateImmediate'),
  refPartialOp('updateSome', 'data-first', 'refUpdateSomeDataFirst'),
  refPartialOp('updateSome', 'data-last-pipe-arg', 'refUpdateSomePipeArg'),
  refPartialOp('updateSome', 'data-last-pipe-method', 'refUpdateSomePipeMethod'),
  refOp('updateAndGet', 'data-first', 'refUpdateAndGetDataFirst'),
  refOp('updateAndGet', 'data-last-pipe-arg', 'refUpdateAndGetPipeArg'),
  refOp('updateAndGet', 'data-last-pipe-method', 'refUpdateAndGetPipeMethod'),
  refOp('getAndUpdate', 'data-first', 'refGetAndUpdateDataFirst'),
  refOp('getAndUpdate', 'data-last-pipe-arg', 'refGetAndUpdatePipeArg'),
  refOp('getAndUpdate', 'data-last-pipe-method', 'refGetAndUpdatePipeMethod'),

  syncOp('modify', 'data-first', 'syncModifyDataFirst'),
  syncOp('modify', 'data-last-pipe-arg', 'syncModifyPipeArg'),
  syncOp('modify', 'data-last-pipe-method', 'syncModifyPipeMethod'),
  syncPartialOp('modifySome', 'data-first', 'syncModifySomeDataFirst'),
  syncPartialOp('modifySome', 'data-last-pipe-arg', 'syncModifySomePipeArg'),
  syncPartialOp('modifySome', 'data-last-pipe-method', 'syncModifySomePipeMethod'),
  syncOp('update', 'data-first', 'syncUpdateDataFirst'),
  syncOp('update', 'data-last-pipe-arg', 'syncUpdatePipeArg'),
  syncOp('update', 'data-last-pipe-method', 'syncUpdatePipeMethod'),
  syncPartialOp('updateSome', 'data-first', 'syncUpdateSomeDataFirst'),
  syncPartialOp('updateSome', 'data-last-pipe-arg', 'syncUpdateSomePipeArg'),
  syncPartialOp('updateSome', 'data-last-pipe-method', 'syncUpdateSomePipeMethod'),
  syncOp('updateAndGet', 'data-first', 'syncUpdateAndGetDataFirst'),
  syncOp('updateAndGet', 'data-last-pipe-arg', 'syncUpdateAndGetPipeArg'),
  syncOp('updateAndGet', 'data-last-pipe-method', 'syncUpdateAndGetPipeMethod'),
  syncOp('getAndUpdate', 'data-first', 'syncGetAndUpdateDataFirst'),
  syncOp('getAndUpdate', 'data-last-pipe-arg', 'syncGetAndUpdatePipeArg'),
  syncOp('getAndUpdate', 'data-last-pipe-method', 'syncGetAndUpdatePipeMethod'),

  semaphoreOp('withPermits', 'data-first', 'withPermitsDataFirst'),
  semaphoreOp('withPermits', 'data-last-pipe-arg', 'withPermitsPipeArg'),
  semaphoreOp('withPermits', 'data-last-pipe-method', 'withPermitsPipeMethod'),
  semaphoreOp('withPermits', 'data-last-immediate', 'withPermitsImmediate'),
  semaphoreOp('withPermit', 'data-first', 'withPermitDataFirst'),
  semaphoreOp('withPermit', 'data-last-pipe-arg', 'withPermitPipeArg'),
  semaphoreOp('withPermit', 'data-last-pipe-method', 'withPermitPipeMethod'),

  regionOp('uninterruptible', 'data-first', 'uninterruptibleCall'),
  regionOp('uninterruptible', 'data-last-pipe-method', 'uninterruptiblePipedReference'),
  regionOp('uninterruptibleMask', 'data-first', 'uninterruptibleMaskRegion'),

  shape(
    'SynchronizationRemoval',
    'Effect',
    'uninterruptibleMask',
    'data-first',
    FINALIZER,
    'leaderLockScopeClose',
    1,
    noScenarios,
  ),

  finalizerOp('ensuring', 'data-first', 'ensuringDataFirst'),
  finalizerOp('ensuring', 'data-last-pipe-arg', 'ensuringPipeArg'),
  finalizerOp('ensuring', 'data-last-pipe-method', 'ensuringPipeMethod'),
  finalizerOp('onExit', 'data-first', 'onExitDataFirst'),
  finalizerOp('onExit', 'data-last-pipe-arg', 'onExitPipeArg'),
  finalizerOp('onExit', 'data-last-pipe-method', 'onExitPipeMethod'),
  finalizerOp('onError', 'data-first', 'onErrorDataFirst'),
  finalizerOp('onError', 'data-last-pipe-arg', 'onErrorPipeArg'),
  finalizerOp('onError', 'data-last-pipe-method', 'onErrorPipeMethod'),
  handlerOp('onInterrupt', 'data-first', 'onInterruptDataFirst'),
  handlerOp('onInterrupt', 'data-last-pipe-arg', 'onInterruptPipeArg'),
  handlerOp('onInterrupt', 'data-last-pipe-method', 'onInterruptPipeMethod'),

  shape(
    'FinalizerEscape',
    'Effect',
    'acquireRelease',
    'data-first',
    FINALIZER,
    'acquireReleaseTwoArg',
    1,
    bracketKinds,
  ),
  shape(
    'FinalizerEscape',
    'Effect',
    'acquireRelease',
    'data-first',
    FINALIZER,
    'acquireReleaseThreeArg',
    1,
    bracketKinds,
  ),
  shape(
    'FinalizerEscape',
    'Effect',
    'acquireRelease',
    'data-first',
    FINALIZER,
    'acquireReleaseDivergence',
    1,
    ['divergence-interrupt-acquire'],
  ),
  shape(
    'FinalizerEscape',
    'Effect',
    'acquireUseRelease',
    'data-first',
    FINALIZER,
    'acquireUseReleaseBrackets',
    1,
    ['equivalence-success', 'equivalence-failure', 'divergence-interrupt-use'],
  ),

  shape(
    'FinalizerEscape',
    'Effect',
    'onError',
    'data-last-pipe-method',
    FINALIZER,
    'leaderLockScopeClose',
    1,
    noScenarios,
  ),
  shape(
    'FinalizerEscape',
    'Effect',
    'ensuring',
    'data-last-pipe-method',
    FINALIZER,
    'leaderLockScopeClose',
    1,
    noScenarios,
  ),

  shape(
    'AtomicUpdateSplit',
    'Ref',
    'update',
    'data-first',
    REFUSALS,
    'localUpdateRefusal',
    0,
    noScenarios,
  ),
  shape(
    'AtomicUpdateSplit',
    'Ref',
    'update',
    'data-first',
    REFUSALS,
    'localDeclarationRefusal',
    0,
    noScenarios,
  ),
  shape(
    'AtomicUpdateSplit',
    'Ref',
    'update',
    'data-first',
    REFUSALS,
    'parameterShadowRefusal',
    0,
    noScenarios,
  ),
  shape(
    'AtomicUpdateSplit',
    'Ref',
    'update',
    'data-last-outside-pipe',
    REFUSALS,
    'dataLastOutsidePipeRefusal',
    0,
    noScenarios,
  ),
  shape(
    'FinalizerEscape',
    'Effect',
    'onInterrupt',
    'data-first',
    REFUSALS,
    'nestedCoveredCalls',
    2,
    noScenarios,
  ),
  shape(
    'AtomicUpdateSplit',
    'Ref',
    'update',
    'data-first',
    'effect-concurrency/import-style-bare-function-no-binding.ts',
    'bareFunctionUpdateWithoutRefBinding',
    0,
    noScenarios,
  ),
]

export interface ImportStyleEntry {
  readonly style: string
  readonly file: string
  readonly exportName: string
  readonly expectedMutants: number
}

export const importStyles: readonly ImportStyleEntry[] = [
  {
    style: 'named',
    file: 'effect-concurrency/import-style-named.ts',
    exportName: 'namedImportUpdate',
    expectedMutants: 1,
  },
  {
    style: 'aliased',
    file: 'effect-concurrency/import-style-aliased.ts',
    exportName: 'aliasedImportUpdate',
    expectedMutants: 1,
  },
  {
    style: 'effect-namespace',
    file: 'effect-concurrency/import-style-effect-namespace.ts',
    exportName: 'effectNamespaceUpdate',
    expectedMutants: 1,
  },
  {
    style: 'module-namespace',
    file: 'effect-concurrency/import-style-module-namespace.ts',
    exportName: 'moduleNamespaceUpdate',
    expectedMutants: 1,
  },
  {
    style: 'bare-function-with-ref-binding',
    file: 'effect-concurrency/import-style-bare-function.ts',
    exportName: 'bareFunctionUpdate',
    expectedMutants: 1,
  },
  {
    style: 'bare-function-without-ref-binding',
    file: 'effect-concurrency/import-style-bare-function-no-binding.ts',
    exportName: 'bareFunctionUpdateWithoutRefBinding',
    expectedMutants: 0,
  },
]
