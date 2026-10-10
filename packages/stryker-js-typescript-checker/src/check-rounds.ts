import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { offsetAt } from '@systemfsoftware/stryker-js-instrumenter'
import type { Checker, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type { Diagnostic } from 'typescript/unstable/async'

import {
  admitImporterShortcut,
  type ImporterShortcutDecision,
  ShortcutTaken,
} from './admit-importer-shortcut.workflow.js'
import { type ImporterCheck, TypescriptCheckerOptionsSchema } from './Checker.schema.js'
import { DecideImporterShortcutCommand, PlanCheckRoundsCommand } from './CheckerCommands.schema.js'
import { type CompilerError, CompilerFailed } from './Compiler.schema.js'
import { type EditSiteFacts, editSiteFactsOf, type Span } from './edit-site.schema.js'
import { type CheckRound, planCheckRounds } from './plan-check-rounds.workflow.js'
import {
  annotateDiagnosticSample,
  type CheckSteps,
  checkStepsOf,
  classifyBatchTce,
  type CompilerState,
  describeDiagnostics,
  type EditTree,
  emptyTally,
  type MutantCheck,
  runtimeOf,
  type TSCompiler,
  type TSCompilerRuntime,
} from './ts-compiler.handle.js'
import type { ScriptFile } from './ts-files.handle.js'

const decodeCheckerOptions = S.decodeUnknownEffect(TypescriptCheckerOptionsSchema)

const importerCheckOf = (options: Options.StrykerOptions): Effect.Effect<ImporterCheck, CompilerFailed> =>
  Effect.mapBoth(decodeCheckerOptions(options), {
    onFailure: (issue) => CompilerFailed.make({ reason: 'invalid-checker-options', subject: issue.message }),
    onSuccess: (decoded) =>
      Option.getOrElse(
        Option.flatMapNullishOr(Option.fromUndefinedOr(decoded.typescriptChecker), (options) => options.importerCheck),
        (): ImporterCheck => 'location-rule',
      ),
  })

type Mutant = Checker.CheckerMutantWire

const decided = <A>(result: Result.Result<A, never>): A =>
  Result.match(result, { onFailure: (refused) => refused, onSuccess: (decision) => decision })

interface Outcome {
  readonly check: MutantCheck
  readonly decision: Option.Option<ImporterShortcutDecision>
}

interface CallContext {
  readonly self: TSCompiler
  readonly rt: TSCompilerRuntime
  readonly steps: CheckSteps
  readonly state: CompilerState
  readonly originals: HashMap.HashMap<string, EditSiteFacts>
}

interface Progress {
  readonly previous: ReadonlyArray<Mutant>
  readonly outcomes: ReadonlyArray<Outcome>
}

const isShortcutTaken = S.is(ShortcutTaken)

const admitted = (original: EditSiteFacts, mutated: EditSiteFacts): ImporterShortcutDecision =>
  decided(admitImporterShortcut(DecideImporterShortcutCommand.make({ original, mutated })))

const eligibleOn = (original: EditSiteFacts): boolean => isShortcutTaken(admitted(original, original))

const takesShortcut = (decision: Option.Option<ImporterShortcutDecision>): boolean =>
  Option.exists(decision, isShortcutTaken)

const fileNamesOf = (steps: CheckSteps, mutants: ReadonlyArray<Mutant>): ReadonlyArray<string> =>
  Arr.dedupe(Arr.map(mutants, (mutant) => steps.resolveFileName(mutant.fileName)))

const spanOf = (script: ScriptFile, mutant: Mutant): Option.Option<Span> =>
  Option.map(
    Option.all([offsetAt(script.lineStarts, mutant.location.start), offsetAt(script.lineStarts, mutant.location.end)]),
    ([start, end]) => ({ start, end }),
  )

const fileOriginalsOf = (
  steps: CheckSteps,
  fileName: string,
  fileMutants: ReadonlyArray<Mutant>,
): Effect.Effect<ReadonlyArray<readonly [string, EditSiteFacts]>, CompilerFailed> =>
  Effect.gen(function*() {
    const file = yield* steps.fileOf(fileName)
    const tree = yield* steps.editTreeOf(fileName)
    return Option.match(Option.all([file, tree]), {
      onNone: (): ReadonlyArray<readonly [string, EditSiteFacts]> => [],
      onSome: ([script, edited]) =>
        Arr.getSomes(
          Arr.map(fileMutants, (mutant) =>
            Option.map(
              spanOf(script, mutant),
              (span) => [mutant.id, editSiteFactsOf(edited.sourceFile, span, edited.syntaxErrors)] as const,
            )),
        ),
    })
  })

const locationRuleOriginalsOf = (
  steps: CheckSteps,
  mutants: ReadonlyArray<Mutant>,
): Effect.Effect<HashMap.HashMap<string, EditSiteFacts>, CompilerFailed> =>
  Effect.map(
    Effect.forEach(fileNamesOf(steps, mutants), (fileName) =>
      fileOriginalsOf(
        steps,
        fileName,
        Arr.filter(mutants, (mutant) => steps.resolveFileName(mutant.fileName) === fileName),
      )),
    (perFile) => HashMap.fromIterable(Arr.flatten(perFile)),
  )

const originalsOf = (
  steps: CheckSteps,
  mode: ImporterCheck,
  mutants: ReadonlyArray<Mutant>,
): Effect.Effect<HashMap.HashMap<string, EditSiteFacts>, CompilerFailed> =>
  Match.value(mode).pipe(
    Match.when('always', () => Effect.succeed(HashMap.empty<string, EditSiteFacts>())),
    Match.when('location-rule', () => locationRuleOriginalsOf(steps, mutants)),
    Match.exhaustive,
  )

const appliedOf = (mutant: Mutant, held: boolean): string =>
  Boolean.match(held, { onTrue: () => mutant.replacement, onFalse: () => `(${mutant.replacement})` })

const mutatedFactsOf = (
  steps: CheckSteps,
  fileName: string,
  original: EditSiteFacts,
  applied: string,
): Effect.Effect<Option.Option<EditSiteFacts>, CompilerFailed> =>
  Effect.map(
    steps.editTreeOf(fileName),
    Option.map((edited: EditTree) =>
      editSiteFactsOf(
        edited.sourceFile,
        { start: original.span.start, end: original.span.start + applied.length },
        edited.syntaxErrors,
      )
    ),
  )

const decisionAfterApplyOf = (
  ctx: CallContext,
  mutant: Mutant,
  fileName: string,
  applied: string,
): Effect.Effect<Option.Option<ImporterShortcutDecision>, CompilerFailed> =>
  Option.match(HashMap.get(ctx.originals, mutant.id), {
    onNone: () => Effect.succeedNone,
    onSome: (original) =>
      Boolean.match(eligibleOn(original), {
        onFalse: () => Effect.succeedSome(admitted(original, original)),
        onTrue: () =>
          Effect.map(
            mutatedFactsOf(ctx.steps, fileName, original, applied),
            Option.map((mutated) => admitted(original, mutated)),
          ),
      }),
  })

const renderedOf = (
  ctx: CallContext,
  mutant: Mutant,
  diagnostics: ReadonlyArray<Diagnostic>,
  decision: Option.Option<ImporterShortcutDecision>,
): Effect.Effect<Outcome> =>
  Effect.map(describeDiagnostics(ctx.self, diagnostics), (rendered) => ({
    check: { mutantId: mutant.id, diagnostics: rendered },
    decision,
  }))

const soloOutcomeOf = (ctx: CallContext, mutant: Mutant, previous: ReadonlyArray<Mutant>) =>
  Effect.gen(function*() {
    yield* ctx.steps.resetMutatedFiles(previous)
    const fileName = ctx.steps.resolveFileName(mutant.fileName)
    const changedFiles = Arr.dedupe([...fileNamesOf(ctx.steps, previous), fileName])
    const file = yield* ctx.steps.fileOf(fileName)
    yield* ctx.steps.applyMutant(mutant, mutant.replacement)
    yield* ctx.steps.refreshSnapshot(changedFiles)
    const held = yield* ctx.steps.parseHeldAfterSplice(file, mutant, fileName)
    yield* Boolean.match(held, {
      onTrue: () => Effect.void,
      onFalse: () => ctx.steps.parenthesizedSplice(mutant, fileName, changedFiles),
    })
    const decision = yield* decisionAfterApplyOf(ctx, mutant, fileName, appliedOf(mutant, held))
    const diagnostics = yield* Boolean.match(takesShortcut(decision), {
      onTrue: () => ctx.steps.ownErrorsIn(fileName),
      onFalse: () => ctx.steps.allErrorsIn(ctx.state, fileName),
    })
    return yield* renderedOf(ctx, mutant, diagnostics, decision)
  })

const respliceAll = (
  ctx: CallContext,
  unheld: ReadonlyArray<Mutant>,
  changedFiles: ReadonlyArray<string>,
): Effect.Effect<void, CompilerFailed> =>
  Boolean.match(unheld.length === 0, {
    onTrue: () => Effect.void,
    onFalse: () =>
      Effect.andThen(
        Effect.forEach(unheld, (mutant) => ctx.steps.applyMutant(mutant, `(${mutant.replacement})`), { discard: true }),
        Effect.andThen(
          Ref.update(ctx.rt.tally, (tally) => ({ ...tally, resplices: tally.resplices + unheld.length })),
          ctx.steps.refreshSnapshot(changedFiles),
        ),
      ),
  })

interface Member {
  readonly mutant: Mutant
  readonly fileName: string
  readonly file: Option.Option<ScriptFile>
}

interface AppliedMember extends Member {
  readonly held: boolean
}

interface DecidedMember extends Member {
  readonly decision: Option.Option<ImporterShortcutDecision>
}

const memberOf = (steps: CheckSteps, mutant: Mutant): Effect.Effect<Member> => {
  const fileName = steps.resolveFileName(mutant.fileName)
  return Effect.map(steps.fileOf(fileName), (file) => ({ mutant, fileName, file }))
}

const ownOutcomesOf = (
  ctx: CallContext,
  members: ReadonlyArray<DecidedMember>,
): Effect.Effect<ReadonlyArray<Outcome>, CompilerFailed> =>
  Effect.forEach(members, (member) =>
    Effect.flatMap(
      ctx.steps.ownErrorsIn(member.fileName),
      (diagnostics) => renderedOf(ctx, member.mutant, diagnostics, member.decision),
    ))

const sharedOutcomesOf = (
  ctx: CallContext,
  mutants: ReadonlyArray<Mutant>,
  previous: ReadonlyArray<Mutant>,
): Effect.Effect<Option.Option<ReadonlyArray<Outcome>>, CompilerFailed> =>
  Effect.gen(function*() {
    yield* ctx.steps.resetMutatedFiles(previous)
    const members = yield* Effect.forEach(mutants, (mutant) => memberOf(ctx.steps, mutant))
    const changedFiles = Arr.dedupe([...fileNamesOf(ctx.steps, previous), ...fileNamesOf(ctx.steps, mutants)])
    yield* Effect.forEach(mutants, (mutant) => ctx.steps.applyMutant(mutant, mutant.replacement), { discard: true })
    yield* ctx.steps.refreshSnapshot(changedFiles)
    const applied = yield* Effect.forEach(members, (member): Effect.Effect<AppliedMember, CompilerFailed> =>
      Effect.map(
        ctx.steps.parseHeldAfterSplice(member.file, member.mutant, member.fileName),
        (held) => ({ ...member, held }),
      ))
    yield* respliceAll(
      ctx,
      Arr.map(Arr.filter(applied, (member) => Boolean.not(member.held)), (member) => member.mutant),
      changedFiles,
    )
    const decidedMembers = yield* Effect.forEach(applied, (member): Effect.Effect<DecidedMember, CompilerFailed> =>
      Effect.map(
        decisionAfterApplyOf(ctx, member.mutant, member.fileName, appliedOf(member.mutant, member.held)),
        (decision) => ({ ...member, decision }),
      ))
    return yield* Boolean.match(
      Arr.every(decidedMembers, (member) =>
        takesShortcut(member.decision)),
      {
        onFalse: () =>
          Effect.succeedNone,
        onTrue: () => Effect.asSome(ownOutcomesOf(ctx, decidedMembers)),
      },
    )
  })

const soloChainOf = (
  ctx: CallContext,
  mutants: ReadonlyArray<Mutant>,
  start: Progress,
): Effect.Effect<Progress, CompilerFailed> =>
  Effect.reduce(
    mutants,
    () => start,
    (progress, mutant) =>
      Effect.map(soloOutcomeOf(ctx, mutant, progress.previous), (outcome): Progress => ({
        previous: [mutant],
        outcomes: [...progress.outcomes, outcome],
      })),
  )

const sharedProgressOf = (
  ctx: CallContext,
  mutants: ReadonlyArray<Mutant>,
  progress: Progress,
): Effect.Effect<Progress, CompilerFailed> =>
  Effect.flatMap(sharedOutcomesOf(ctx, mutants, progress.previous), (outcomes) =>
    Option.match(outcomes, {
      onNone: () => soloChainOf(ctx, mutants, { previous: mutants, outcomes: progress.outcomes }),
      onSome: (shared) => Effect.succeed<Progress>({ previous: mutants, outcomes: [...progress.outcomes, ...shared] }),
    }))

const mutantsOf = (byId: HashMap.HashMap<string, Mutant>, ids: ReadonlyArray<string>): ReadonlyArray<Mutant> =>
  Arr.getSomes(Arr.map(ids, (id) => HashMap.get(byId, id)))

const roundProgressOf = (
  ctx: CallContext,
  byId: HashMap.HashMap<string, Mutant>,
  progress: Progress,
  round: CheckRound,
): Effect.Effect<Progress, CompilerFailed> =>
  Match.valueTags(round, {
    SoloRound: (solo) => soloChainOf(ctx, mutantsOf(byId, [solo.id]), progress),
    SharedRound: (shared) => sharedProgressOf(ctx, mutantsOf(byId, shared.ids), progress),
  })

const roundsOf = (ctx: CallContext, mutants: ReadonlyArray<Mutant>): ReadonlyArray<CheckRound> =>
  decided(
    planCheckRounds(
      PlanCheckRoundsCommand.make({
        candidates: Arr.map(mutants, (mutant) => ({
          id: mutant.id,
          fileName: ctx.steps.resolveFileName(mutant.fileName),
          eligible: Option.exists(HashMap.get(ctx.originals, mutant.id), eligibleOn),
        })),
      }),
    ),
  )

const inInputOrder = (mutants: ReadonlyArray<Mutant>, outcomes: ReadonlyArray<Outcome>): ReadonlyArray<Outcome> => {
  const byId = HashMap.fromIterable(Arr.map(outcomes, (outcome) => [outcome.check.mutantId, outcome] as const))
  return Arr.getSomes(Arr.map(mutants, (mutant) => HashMap.get(byId, mutant.id)))
}

const fallbackKeyOf = (decision: Option.Option<ImporterShortcutDecision>): Option.Option<string> =>
  Option.match(decision, {
    onNone: () => Option.some('unread'),
    onSome: (decided) =>
      Match.valueTags(decided, {
        ShortcutTaken: () => Option.none<string>(),
        ImportersRechecked: (rechecked) => Option.some(`${rechecked.tree}.${rechecked.clause}`),
      }),
  })

const locationRuleAttributesOf = (outcomes: ReadonlyArray<Outcome>): Record<string, number> => ({
  'typescript.importer_shortcut.count': Arr.filter(outcomes, (outcome) => takesShortcut(outcome.decision)).length,
  ...Object.fromEntries(
    Object.entries(
      Arr.groupBy(Arr.getSomes(Arr.map(outcomes, (outcome) => fallbackKeyOf(outcome.decision))), (key) => key),
    )
      .map(([key, keys]) => [`typescript.importer_shortcut.fallback.${key}.count`, keys.length]),
  ),
})

const shortcutAttributesOf = (mode: ImporterCheck, outcomes: ReadonlyArray<Outcome>): Record<string, number> =>
  Match.value(mode).pipe(
    Match.when('always', () => ({ 'typescript.importer_shortcut.count': 0 })),
    Match.when('location-rule', () => locationRuleAttributesOf(outcomes)),
    Match.exhaustive,
  )

export const check: {
  (
    mutants: readonly Checker.CheckerMutantWire[],
  ): (self: TSCompiler) => Effect.Effect<ReadonlyArray<MutantCheck>, CompilerError>
  (
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.Effect<ReadonlyArray<MutantCheck>, CompilerError>
} = dual(
  2,
  Effect.fn(SpanTaxonomy.Spans.typescriptCheckerCompilerCheck.name)(function*(
    self: TSCompiler,
    mutants: readonly Checker.CheckerMutantWire[],
  ): Effect.fn.Return<ReadonlyArray<MutantCheck>, CompilerError> {
    const rt = runtimeOf(self)
    const steps = checkStepsOf(rt)
    yield* Effect.annotateCurrentSpan({
      'stryker.mutants.count': mutants.length,
      'stryker.mutants.ids': Arr.map(mutants, (mutant) => mutant.id).join(','),
    })
    yield* Ref.set(rt.tally, emptyTally)
    const state = yield* SynchronizedRef.get(rt.state)
    const mode = yield* importerCheckOf(rt.options)
    yield* steps.resetMutatedFiles(state.lastMutants)
    yield* steps.refreshSnapshot(Arr.dedupe([...state.lastMutatedFileNames, ...fileNamesOf(steps, mutants)]))
    const originals = yield* originalsOf(steps, mode, mutants)
    const ctx: CallContext = { self, rt, steps, state, originals }
    const byId = HashMap.fromIterable(Arr.map(mutants, (mutant) => [mutant.id, mutant] as const))
    const progress = yield* Effect.reduce(
      roundsOf(ctx, mutants),
      (): Progress => ({ previous: [], outcomes: [] }),
      (current, round) => roundProgressOf(ctx, byId, current, round),
    )
    const outcomes = inInputOrder(mutants, progress.outcomes)
    const checked = yield* classifyBatchTce(
      rt,
      state.tsconfigFile,
      mutants,
      Arr.map(outcomes, (outcome) => outcome.check),
    )
    yield* SynchronizedRef.update(rt.state, (prev) => ({
      ...prev,
      lastMutants: [...progress.previous],
      lastMutatedFileNames: fileNamesOf(steps, progress.previous),
    }))
    const failed = Arr.filter(checked, (entry) => entry.diagnostics.length > 0)
    const equivalentToOriginal = Arr.filter(checked, (entry) => entry.tce === 'original').length
    const duplicateAtSite = Arr.filter(checked, (entry) => entry.tce === 'sibling').length
    const tally = yield* Ref.get(rt.tally)
    yield* Effect.annotateCurrentSpan({
      'typescript.diagnostics.count': Arr.reduce(checked, 0, (total, entry) => total + entry.diagnostics.length),
      'typescript.compile_errors.count': failed.length,
      'typescript.tce.equivalent_to_original.count': equivalentToOriginal,
      'typescript.tce.duplicate_at_site.count': duplicateAtSite,
      'typescript.counts.schema_version': 1,
      'typescript.snapshot_updates.count': tally.snapshotUpdates,
      'typescript.resplices.count': tally.resplices,
      'typescript.tce_builds.count': tally.tceBuilds,
      'typescript.tce.ms': tally.tceMs,
      ...shortcutAttributesOf(mode, outcomes),
    })
    yield* annotateDiagnosticSample(Arr.flatten(Arr.map(failed, (entry) => entry.diagnostics)))
    return checked
  }),
)
