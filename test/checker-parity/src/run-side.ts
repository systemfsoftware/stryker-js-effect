import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Worker } from '@systemfsoftware/stryker-js'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, type Mutant, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { assignDriftLegs, AssignDriftLegsCommand } from './assign-drift-legs.workflow.js'
import { blocksOf, DEFAULT_BLOCK_MUTANTS } from './blocks.js'
import { appendStepSummary, type CiEnvironment } from './ci-environment.js'
import {
  corpusEntries,
  ISOLATED_DECLARATIONS_PROJECT,
  programFilesFromListing,
  tsconfigsNamedByConfig,
} from './corpus.js'
import { DriverFailure } from './DriverFailure.schema.js'
import { execText } from './exec-text.js'
import { changedFiles } from './lane-trigger.js'
import { type OtlpReceiver, startOtlpReceiver } from './otlp-receiver.js'
import {
  CacheEntry,
  CheckCall,
  Counts,
  Deferred,
  DigestCall,
  GroupCall,
  LegFile,
  LegScope,
  LegStarted,
  ParityLine,
  ParityPlan,
  PhaseLine,
  PlannedLeg,
  PlannedUnit,
  ProjectBootFailed,
  ProjectSkipped,
  type RunScopeName,
  ScopeSettings,
  seededOrder,
  type Shard,
  shardCount,
  shardIndex,
  Side,
  TelemetryMissing,
  UnitOverBudget,
  Verdict,
} from './Parity.schema.js'
import { CorpusFile } from './plan-legs.workflow.js'
import {
  BatchInterrupts,
  reuseCachedVerdicts,
  ReuseCachedVerdictsCommand,
  VerdictCacheIdentity,
} from './reuse-cached-verdicts.workflow.js'
import { selectScope, SelectScopeCommand } from './select-scope.workflow.js'
import { inShard } from './shard.js'
import {
  COUNTS_SCHEMA_VERSION,
  countsOfSpans,
  countsSchemaVersionsOf,
  projectCheckSpans,
  type SpanRecord,
} from './span-counts.js'
import { branchTypeQueryLines, type FileContent, type ServerTally } from './type-query-side.js'

const decodeParityLine = S.decodeResult(S.fromJsonString(ParityLine))
const encodeParityLine = S.encodeResult(S.fromJsonString(ParityLine))
const decodeTypescriptPackage = S.decodeResult(
  S.fromJsonString(S.Struct({ bin: S.optional(S.Struct({ tsc: S.optional(S.String) })) })),
)

export interface RunCommand {
  readonly scope: RunScopeName
  readonly base: Option.Option<string>
  readonly settings: Option.Option<string>
  readonly mainWorker: string
  readonly branchWorker: string
  readonly shard: Shard
  readonly cache: string
  readonly out: string
  readonly plan: Option.Option<string>
  readonly deadline: Option.Option<number>
}

export type DriverServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

const MAIN_SERVICE = 'checker-parity-main'
const BRANCH_SERVICE = 'checker-parity-branch'
const CHECKER_NAME = 'typescript'
const SPAN_POLL = Duration.millis(25)
const SPAN_POLLS = 200
const BATCH_MUTANTS = 16
const OVER_BUDGET_INTERRUPTS = 2

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never
type CheckerClient = RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>

const ioFailure = (reason: string, nextAction: string): DriverFailure =>
  DriverFailure.make({ schemaVersion: 1, code: 'io-failed', reason, nextAction })

const rpcFailure = (detail: string): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'rpc-failed',
    reason: `A checker worker RPC failed: ${detail}`,
    nextAction: 'Rerun the shard; if it repeats, inspect the worker stderr for the failing project.',
  })

const exists = (file: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => Effect.orElseSucceed(fs.exists(file), () => false))

const readText = (file: string): Effect.Effect<string, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(file)).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not read ${file}: ${cause.message}`, `Check the path ${file} exists and is readable.`)
    ),
  )

const writeText = (file: string, content: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.writeFileString(file, content)).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not write ${file}: ${cause.message}`, `Check the directory of ${file} exists and is writable.`)
    ),
  )

const appendText = (file: string, content: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.writeFileString(file, content, { flag: 'a' })).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not append to ${file}: ${cause.message}`, `Check the directory of ${file} is writable.`)
    ),
  )

const makeDirectory = (directory: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.makeDirectory(directory, { recursive: true })).pipe(
    Effect.mapError((cause) =>
      ioFailure(
        `Could not create ${directory}: ${cause.message}`,
        `Create ${directory} or point --out/--cache at a writable directory.`,
      )
    ),
  )

const isFile = (file: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) =>
    fs.stat(file).pipe(Effect.map((info) => info.type === 'File'), Effect.orElseSucceed(() => false))
  )

const sha256Tree = (directory: string): Effect.Effect<string, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(directory, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        ioFailure(`Could not walk ${directory}: ${cause.message}`, `Check the directory ${directory} exists.`)
      ),
    )
    const files = yield* Effect.filter(Arr.sort(entries, Str.Order), (entry) => isFile(path.join(directory, entry)))
    const hash = sha256.create()
    yield* Effect.forEach(files, (file) =>
      fs.readFile(path.join(directory, file)).pipe(
        Effect.map((bytes) => hash.update(utf8ToBytes(`${file}\u0000`)).update(bytes).update(utf8ToBytes('\u0000'))),
        Effect.mapError((cause) =>
          ioFailure(`Could not hash ${file} under ${directory}: ${cause.message}`, `Check ${file} is readable.`)
        ),
      ), { discard: true })
    return bytesToHex(hash.digest())
  })

const gitTrackedFiles = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<string>, DriverFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(
    execText({ file: 'git', args: ['ls-files', '-z'], cwd: repoRoot }),
    (stdout) => stdout.split('\u0000').filter(Str.isNonEmpty),
  )

const decodeOptions = (tsconfigFile: string): Options.StrykerOptions =>
  Result.getOrThrow(S.decodeResult(Options.StrykerOptionsSchema)({ tsconfigFile, typescriptChecker: {} }))

const instrumenterOptions: Instrument.InstrumenterOptions = {
  excludedMutations: [],
  ignorers: [],
  mutantSetPolicy: 'default',
  mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
}

const toWire = (mutant: Mutant.Mutant): Checker.CheckerMutantWire => ({
  id: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: mutant.location,
})

const encodeLine = (line: ParityLine): Effect.Effect<string, DriverFailure> =>
  Effect.fromResult(
    Result.mapError(encodeParityLine(line), (issue) =>
      ioFailure(
        `Could not encode a ${line._tag} line: ${issue.message}`,
        'Inspect the line kind in Parity.schema.ts.',
      )),
  )

const ndjsonOf = (lines: ReadonlyArray<ParityLine>): Effect.Effect<string, DriverFailure> =>
  Effect.map(
    Effect.forEach(lines, encodeLine),
    (encoded) => encoded.map((line) => `${line}\n`).join(''),
  )

export const decodeLines: {
  (file: string): (content: string) => Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure>
  (content: string, file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure>
} = dual(
  2,
  (content: string, file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure> =>
    Effect.fromResult(
      Result.all(
        content.split('\n').flatMap((raw, index) =>
          Str.isNonEmpty(raw.trim())
            ? [
              Result.mapError(decodeParityLine(raw), () =>
                DriverFailure.make({
                  schemaVersion: 1,
                  code: 'decode-failed',
                  reason: `${file}:${index + 1} is not a parity line`,
                  nextAction: `Fix or delete the malformed line in ${file}.`,
                })),
            ]
            : []
        ),
      ),
    ),
)

const fileContentsOf = (
  input: ProjectInput,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<ReadonlyArray<FileContent>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    return yield* Effect.forEach(
      Arr.dedupe(wires.map((wire) => wire.fileName)),
      (name) => Effect.map(readText(path.resolve(input.repoRoot, name)), (content) => ({ name, content })),
    )
  })
export interface LegDeadline {
  readonly startedAt: number
  readonly deadlineAt: Option.Option<number>
}

interface SideInput {
  readonly side: Side
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly workerPath: string
  readonly bundleHash: string
  readonly cacheDir: string
  readonly blockMutants: number
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly receiver: OtlpReceiver
  readonly serviceName: string
  readonly deadline: LegDeadline
}

interface FileRun {
  readonly lines: ReadonlyArray<ParityLine>
  readonly freshCheckCalls: number
  readonly cached: boolean
}

interface SideRun {
  readonly bootFailed: boolean
  readonly lines: ReadonlyArray<ParityLine>
  readonly expectedCheckSpans: number
  readonly cachedFiles: number
  readonly freshFiles: number
}

const isVerdict = S.is(Verdict)
const isReplayedAsIs = S.is(S.Union([Counts, UnitOverBudget]))

const cachedVerdict = (line: Verdict): Verdict =>
  Verdict.make({
    schemaVersion: 1,
    side: line.side,
    project: line.project,
    mutantId: line.mutantId,
    fileName: line.fileName,
    line: line.line,
    status: line.status,
    reason: line.reason,
    cached: true,
  })

const cachedLine = (line: ParityLine): Option.Option<ParityLine> =>
  Option.liftPredicate(line, isVerdict).pipe(
    Option.map(cachedVerdict),
    Option.orElse(() => Option.liftPredicate(line, isReplayedAsIs)),
  )

const readCacheFile = (file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure, FileSystem.FileSystem> =>
  Effect.flatMap(
    readText(file),
    (content) => Effect.map(decodeLines(content, file), (lines) => Arr.getSomes(lines.map(cachedLine))),
  )

const answerReasonOf = (answer: Checker.CheckAnswer): string | undefined =>
  Checker.CheckAnswerSchema.match(answer, {
    passed: () => undefined,
    compileError: ({ reason }) => reason,
    ignored: ({ reason }) =>
      Option.getOrElse(Option.liftPredicate(reason, Predicate.isString), () => JSON.stringify(reason)),
  })

const verdictOf = (input: SideInput, wire: Checker.CheckerMutantWire, answer: Checker.CheckAnswer): Verdict =>
  Verdict.make({
    schemaVersion: 1,
    side: input.side,
    project: input.project,
    mutantId: wire.id,
    fileName: wire.fileName,
    line: wire.location.start.line,
    status: answer.status,
    reason: answerReasonOf(answer),
    cached: false,
  })

const unsupportedVersion = (version: number): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'telemetry-version-unsupported',
    reason: `Branch check spans declared counts schema version ${version}, not ${COUNTS_SCHEMA_VERSION}.`,
    nextAction:
      'Align the checker count attributes with this driver (packages/stryker-js-typescript-checker/src/ts-compiler.handle.ts).',
  })

const awaitCheckSpans = (
  input: SideInput,
  mutantIds: HashSet.HashSet<string>,
  expected: number,
  attempts: number,
): Effect.Effect<ReadonlyArray<SpanRecord>> =>
  Effect.flatMap(input.receiver.spans, (spans) => {
    const found = projectCheckSpans(spans, input.serviceName, mutantIds)
    return Boolean.match(Boolean.some([found.length >= expected, attempts <= 0]), {
      onTrue: () => Effect.succeed(found),
      onFalse: () => Effect.andThen(Effect.sleep(SPAN_POLL), awaitCheckSpans(input, mutantIds, expected, attempts - 1)),
    })
  })

const branchCountsOf = (
  input: SideInput,
  checkSpans: ReadonlyArray<SpanRecord>,
): Effect.Effect<Counts, DriverFailure> =>
  Effect.as(
    Option.match(
      Arr.findFirst(countsSchemaVersionsOf(checkSpans), (version) => version !== COUNTS_SCHEMA_VERSION),
      {
        onNone: () => Effect.void,
        onSome: (version) => Effect.fail(unsupportedVersion(version)),
      },
    ),
    Counts.make({ schemaVersion: 1, side: 'branch', project: input.project, ...countsOfSpans(checkSpans) }),
  )

interface CacheSlot {
  readonly key: string
  readonly verdictsFile: string
  readonly identityFile: string
  readonly interruptsFile: string
  readonly identity: VerdictCacheIdentity
}

const encodeIdentity = S.encodeResult(S.fromJsonString(VerdictCacheIdentity))
const decodeIdentity = S.decodeResult(S.fromJsonString(VerdictCacheIdentity))

const encodeInterrupts = S.encodeResult(S.fromJsonString(BatchInterrupts))
const decodeInterrupts = S.decodeResult(S.fromJsonString(BatchInterrupts))

const cacheSlotOf = (
  input: SideInput,
  batchKey: string,
  identity: VerdictCacheIdentity,
): Effect.Effect<CacheSlot, never, Path.Path> =>
  Path.Path.useSync((path) => {
    const key = bytesToHex(sha256(utf8ToBytes(`${input.project}\u0000${batchKey}`)))
    return {
      key,
      verdictsFile: path.join(input.cacheDir, `${input.side}-${key}.ndjson`),
      identityFile: path.join(input.cacheDir, `${input.side}-${key}.identity.json`),
      interruptsFile: path.join(input.cacheDir, `${input.side}-${key}.interrupts.json`),
      identity,
    }
  })

const storedIdentityOf = (slot: CacheSlot): Effect.Effect<VerdictCacheIdentity | null, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(slot.identityFile)).pipe(
    Effect.map((text) =>
      Result.match(decodeIdentity(text), { onFailure: () => null, onSuccess: (identity) => identity })
    ),
    Effect.orElseSucceed(() => null),
  )

const identityTextOf = (identity: VerdictCacheIdentity): Effect.Effect<string, DriverFailure> =>
  Effect.fromResult(
    Result.mapError(encodeIdentity(identity), (issue) =>
      ioFailure(`Could not encode the verdict cache identity: ${issue.message}`, 'Inspect VerdictCacheIdentity.')),
  )

const storedInterruptsOf = (slot: CacheSlot): Effect.Effect<number, DriverFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const current = yield* identityTextOf(slot.identity)
    const text = yield* FileSystem.FileSystem.use((fs) => fs.readFileString(slot.interruptsFile)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return Result.match(decodeInterrupts(text), {
      onFailure: () => 0,
      onSuccess: (record) =>
        Result.match(encodeIdentity(record.identity), {
          onFailure: () => 0,
          onSuccess: (stored) => stored === current ? record.interrupts : 0,
        }),
    })
  })

const cacheEntry = (input: SideInput, fileName: string, key: string, hit: boolean): CacheEntry =>
  CacheEntry.make({ schemaVersion: 1, side: input.side, project: input.project, fileName, key, hit })

const storeBatch = (
  input: SideInput,
  slot: CacheSlot,
  lines: ReadonlyArray<ParityLine>,
): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const identityText = yield* identityTextOf(slot.identity)
    yield* makeDirectory(input.cacheDir)
    yield* FileSystem.FileSystem.use((fs) => fs.remove(slot.identityFile, { force: true })).pipe(
      Effect.mapError((cause) => ioFailure(cause.message, `Check ${input.cacheDir} is writable.`)),
    )
    yield* writeText(slot.verdictsFile, yield* ndjsonOf(lines))
    yield* writeText(slot.identityFile, identityText)
  })

const storeInterrupts = (
  input: SideInput,
  slot: CacheSlot,
  interrupts: number,
): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const text = yield* Effect.fromResult(
      Result.mapError(encodeInterrupts(BatchInterrupts.make({ identity: slot.identity, interrupts })), (issue) =>
        ioFailure(
          `Could not encode the interrupt record: ${issue.message}`,
          'Inspect BatchInterrupts in Parity.schema.ts.',
        )),
    )
    yield* makeDirectory(input.cacheDir)
    yield* writeText(slot.interruptsFile, text)
  })

interface Batch {
  readonly fileName: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly index: number
  readonly of: number
}

type BatchOutcome = 'cached' | 'checked' | 'deferred' | 'over-budget'

interface BatchRun {
  readonly lines: ReadonlyArray<ParityLine>
  readonly freshCheckCalls: number
  readonly outcome: BatchOutcome
}

const remainingOf = (deadline: LegDeadline): Effect.Effect<Option.Option<number>> =>
  Effect.map(Clock.currentTimeMillis, (now) => Option.map(deadline.deadlineAt, (at) => at - now))

const isPastDeadline = (remaining: Option.Option<number>): boolean => Option.exists(remaining, (ms) => ms <= 0)

const heartbeat = (input: SideInput, detail: string): Effect.Effect<void> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Console.error(
      `checker-parity heartbeat +${seconds(now - input.deadline.startedAt)} ${input.side} ${input.project} ${detail}`,
    ))

const deferredOf = (
  input: SideInput,
  fileName: string,
  mutants: number,
  reason: Deferred['reason'],
): Deferred => Deferred.make({ schemaVersion: 1, side: input.side, project: input.project, fileName, mutants, reason })

const checkBatch = (
  client: CheckerClient,
  input: SideInput,
  slot: CacheSlot,
  batch: Batch,
): Effect.Effect<BatchRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const [checkDuration, results] = yield* Effect.timed(
      client.check({ checkerName: CHECKER_NAME, mutants: [...batch.wires] }),
    )
    const call = CheckCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      fileName: batch.fileName,
      callIndex: batch.index,
      mutantIds: batch.wires.map((wire) => wire.id),
      ms: Duration.toMillis(checkDuration),
      cached: false,
    })
    const verdicts = Arr.getSomes(
      batch.wires.map((wire) =>
        Option.map(Option.fromUndefinedOr(results[wire.id]), (result) => verdictOf(input, wire, result))
      ),
    )
    const counts = yield* Boolean.match(input.side === 'branch', {
      onTrue: () => branchCountsLines(input, batch.wires),
      onFalse: () => Effect.succeed({ lines: Arr.empty<Counts>(), complete: true }),
    })
    const lines = [call, ...verdicts, ...counts.lines]
    yield* Boolean.match(counts.complete, {
      onTrue: () => storeBatch(input, slot, lines),
      onFalse: () => Effect.void,
    })
    return {
      lines: [cacheEntry(input, batch.fileName, slot.key, false), ...lines],
      freshCheckCalls: 1,
      outcome: 'checked',
    }
  })

const interruptedBatch = (
  input: SideInput,
  slot: CacheSlot,
  batch: Batch,
  elapsedMs: number,
): Effect.Effect<BatchRun, DriverFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const interrupts = (yield* storedInterruptsOf(slot)) + 1
    return yield* Boolean.match(interrupts >= OVER_BUDGET_INTERRUPTS, {
      onTrue: () => {
        const overBudget = UnitOverBudget.make({
          schemaVersion: 1,
          side: input.side,
          project: input.project,
          fileName: batch.fileName,
          mutantIds: batch.wires.map((wire) => wire.id),
          interrupts,
          ms: elapsedMs,
        })
        return Effect.as(storeBatch(input, slot, [overBudget]), {
          lines: [cacheEntry(input, batch.fileName, slot.key, false), overBudget],
          freshCheckCalls: 0,
          outcome: 'over-budget' as const,
        })
      },
      onFalse: () =>
        Effect.as(storeInterrupts(input, slot, interrupts), {
          lines: [deferredOf(input, batch.fileName, batch.wires.length, 'interrupted-at-deadline')],
          freshCheckCalls: 0,
          outcome: 'deferred' as const,
        }),
    })
  })

const freshBatch = (
  client: CheckerClient,
  input: SideInput,
  slot: CacheSlot,
  batch: Batch,
): Effect.Effect<BatchRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const remaining = yield* remainingOf(input.deadline)
    return yield* Boolean.match(isPastDeadline(remaining), {
      onTrue: () =>
        Effect.succeed<BatchRun>({
          lines: [deferredOf(input, batch.fileName, batch.wires.length, 'deadline-passed')],
          freshCheckCalls: 0,
          outcome: 'deferred',
        }),
      onFalse: () =>
        Effect.gen(function*() {
          yield* heartbeat(input, `${batch.fileName} batch ${batch.index + 1}/${batch.of} (${batch.wires.length})`)
          const [elapsed, checked] = yield* Effect.timed(
            Option.match(remaining, {
              onNone: () => Effect.asSome(checkBatch(client, input, slot, batch)),
              onSome: (ms) => Effect.timeoutOption(checkBatch(client, input, slot, batch), Duration.millis(ms)),
            }),
          )
          return yield* Option.match(checked, {
            onSome: (run) => Effect.succeed(run),
            onNone: () => interruptedBatch(input, slot, batch, Duration.toMillis(elapsed)),
          })
        }),
    })
  })

const batchRunOf = (
  client: CheckerClient,
  input: SideInput,
  digest: Checker.ProgramDigest,
) =>
(
  batch: Batch,
): Effect.Effect<
  BatchRun,
  DriverFailure | Checker.CheckerFailed | RpcClientError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const slot = yield* cacheSlotOf(
      input,
      [batch.fileName, ...batch.wires.map((wire) => wire.id)].join('\u0000'),
      VerdictCacheIdentity.make({
        schemaVersion: 1,
        bundleHash: input.bundleHash,
        programDigest: digest,
        wires: [...batch.wires],
      }),
    )
    const reuse = yield* Effect.fromResult(
      reuseCachedVerdicts(
        ReuseCachedVerdictsCommand.make({ current: slot.identity, stored: yield* storedIdentityOf(slot) }),
      ),
    )
    return yield* Match.valueTags(reuse, {
      VerdictsReused: () =>
        Effect.map(readCacheFile(slot.verdictsFile), (lines): BatchRun => ({
          lines: [cacheEntry(input, batch.fileName, slot.key, true), ...lines],
          freshCheckCalls: 0,
          outcome: 'cached',
        })),
      CheckFreshly: () => freshBatch(client, input, slot, batch),
    })
  })

const branchCountsLines = (
  input: SideInput,
  batchWires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<{ readonly lines: ReadonlyArray<Counts>; readonly complete: boolean }, DriverFailure> =>
  Effect.gen(function*() {
    const spans = yield* awaitCheckSpans(
      input,
      HashSet.fromIterable(batchWires.map((wire) => wire.id)),
      1,
      SPAN_POLLS,
    )
    return { lines: [yield* branchCountsOf(input, spans)], complete: spans.length >= 1 }
  })

const batchesOf = (
  fileName: string,
  groups: ReadonlyArray<ReadonlyArray<string>>,
  wireById: HashMap.HashMap<string, Checker.CheckerMutantWire>,
): ReadonlyArray<Batch> => {
  const chunks = groups.flatMap((group) => Arr.chunksOf(group, BATCH_MUTANTS))
  return chunks.map((ids, index) => ({
    fileName,
    wires: Arr.getSomes(ids.map((id) => HashMap.get(wireById, id))),
    index,
    of: chunks.length,
  }))
}

const fileRunOf = (
  client: CheckerClient,
  input: SideInput,
  digest: Checker.ProgramDigest,
) =>
(
  fileWires: Arr.NonEmptyReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<FileRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fileName = Arr.headNonEmpty(fileWires).fileName
    const remaining = yield* remainingOf(input.deadline)
    return yield* Boolean.match(isPastDeadline(remaining), {
      onTrue: () =>
        Effect.succeed<FileRun>({
          lines: [deferredOf(input, fileName, fileWires.length, 'deadline-passed')],
          freshCheckCalls: 0,
          cached: false,
        }),
      onFalse: () =>
        Effect.gen(function*() {
          const blockTimings = yield* Effect.forEach(
            blocksOf(fileWires, input.blockMutants),
            (block) => Effect.timed(client.group({ checkerName: CHECKER_NAME, mutants: [...block] })),
          )
          const groups = blockTimings.flatMap(([, grouped]) => grouped)
          const wireById = HashMap.fromIterable(fileWires.map((wire) => [wire.id, wire] as const))
          const runs = yield* Effect.forEach(batchesOf(fileName, groups, wireById), batchRunOf(client, input, digest))
          const groupLine = GroupCall.make({
            schemaVersion: 1,
            side: input.side,
            project: input.project,
            ms: blockTimings.reduce((total, [duration]) => total + Duration.toMillis(duration), 0),
            groups: groups.length,
            cached: false,
          })
          return {
            lines: [groupLine, ...runs.flatMap((run) => run.lines)],
            freshCheckCalls: runs.reduce((total, run) => total + run.freshCheckCalls, 0),
            cached: runs.every((run) => run.outcome === 'cached'),
          }
        }),
    })
  })

const wiresByFile = (
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): ReadonlyArray<Arr.NonEmptyReadonlyArray<Checker.CheckerMutantWire>> =>
  Arr.sortWith(
    Object.values(Arr.groupBy(wires, (wire) => wire.fileName)),
    (fileWires) => fileWires[0].fileName,
    Str.Order,
  )

const sideBody = (
  client: CheckerClient,
  input: SideInput,
): Effect.Effect<
  SideRun,
  DriverFailure | Checker.CheckerFailed | RpcClientError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const [digestDuration, digest] = yield* Effect.timed(client.digest({ checkerName: CHECKER_NAME }))
    const digestLine = DigestCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      ms: Duration.toMillis(digestDuration),
      digest,
      cached: false,
    })
    const files = yield* Effect.forEach(wiresByFile(input.wires), fileRunOf(client, input, digest))
    return {
      bootFailed: false,
      lines: [digestLine, ...files.flatMap((file) => file.lines)],
      expectedCheckSpans: files.reduce((total, file) => total + file.freshCheckCalls, 0),
      cachedFiles: files.filter((file) => file.cached).length,
      freshFiles: files.filter((file) => !file.cached).length,
    }
  })

const bootFailedRun = (input: SideInput, error: Worker.WorkerBootError): Effect.Effect<SideRun> =>
  Effect.succeed({
    bootFailed: true,
    lines: [
      ProjectBootFailed.make({ schemaVersion: 1, side: input.side, project: input.project, reason: error.message }),
    ],
    expectedCheckSpans: 0,
    cachedFiles: 0,
    freshFiles: 0,
  })

const runSide = (
  input: SideInput,
): Effect.Effect<SideRun, DriverFailure, Worker.WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const entrypoint = yield* path.toFileUrl(input.workerPath).pipe(
        Effect.mapError((cause) => ioFailure(cause.message, `Pass an absolute worker path, not ${input.workerPath}.`)),
      )
      const client = yield* Worker.makeWorkerClient({
        rpcs: Plugin.CheckerRpcs,
        options: decodeOptions(input.tsconfigFile),
        entrypoint: entrypoint.href,
        workingDirectory: input.repoRoot,
        execArgv: [],
        tempDirPrefix: `stryker-checker-${input.side}-`,
        env: {
          OTEL_ENABLED: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: input.receiver.endpoint,
          OTEL_SERVICE_NAME: input.serviceName,
        },
      })
      return yield* sideBody(client, input)
    }),
  ).pipe(
    Effect.catchTags({
      ChildProcessCrashedError: (error) => bootFailedRun(input, error),
      OutOfMemoryError: (error) => bootFailedRun(input, error),
      WorkerBootTimeoutError: (error) => bootFailedRun(input, error),
      CheckerFailed: (error) => Effect.fail(rpcFailure(error.message)),
      RpcClientError: (error) => Effect.fail(rpcFailure(error.message)),
    }),
  )

interface PullRequestScope {
  readonly changedFiles: HashSet.HashSet<string>
  readonly settings: ScopeSettings
  readonly driftLegs: HashMap.HashMap<string, number>
}

interface ProjectInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly shard: Shard
  readonly pullRequest: Option.Option<PullRequestScope>
  readonly plannedUnits: Option.Option<ReadonlyArray<PlannedUnit>>
  readonly blockMutants: number
  readonly cacheDir: string
  readonly mainWorker: string
  readonly branchWorker: string
  readonly mainBundleHash: string
  readonly branchBundleHash: string
  readonly servers: Ref.Ref<ServerTally>
  readonly receiver: OtlpReceiver
  readonly deadline: LegDeadline
}

type ProjectStatus = 'ran' | 'skipped' | 'boot-failed' | 'out-of-scope' | 'deferred'

interface ProjectResult {
  readonly lines: ReadonlyArray<ParityLine>
  readonly status: ProjectStatus
  readonly mutants: number
  readonly changedFiles: number
  readonly changedMutants: number
  readonly sampledMutants: number
  readonly cachedFiles: number
  readonly freshFiles: number
  readonly listAndInstrumentMs: number
  readonly workersMs: number
}

const EMPTY_RESULT: ProjectResult = {
  lines: [],
  status: 'out-of-scope',
  mutants: 0,
  changedFiles: 0,
  changedMutants: 0,
  sampledMutants: 0,
  cachedFiles: 0,
  freshFiles: 0,
  listAndInstrumentMs: 0,
  workersMs: 0,
}

const skippedProject = (project: string, reason: string): ProjectResult => ({
  ...EMPTY_RESULT,
  lines: [ProjectSkipped.make({ schemaVersion: 1, project, reason })],
  status: 'skipped',
})

const tscBinPath: Effect.Effect<string, DriverFailure, FileSystem.FileSystem | Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const packageJsonPath = yield* path.fromFileUrl(new URL(import.meta.resolve('typescript/package.json'))).pipe(
    Effect.mapError((cause) => ioFailure(cause.message, 'Install the workspace so typescript resolves.')),
  )
  const packageJson = Result.getOrElse(
    decodeTypescriptPackage(yield* readText(packageJsonPath)),
    () => ({ bin: undefined }),
  )
  const tsc = Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(packageJson.bin), (bin) => Option.fromUndefinedOr(bin.tsc)),
    () => 'bin/tsc',
  )
  return path.resolve(path.dirname(packageJsonPath), tsc)
})

const listProgramFiles = (
  tsconfigFile: string,
  repoRoot: string,
): Effect.Effect<ReadonlyArray<string>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const tsc = yield* tscBinPath
    const listing = yield* execText({
      file: globalThis.process.execPath,
      args: [tsc, '--listFilesOnly', '-p', tsconfigFile],
      cwd: repoRoot,
    })
    return programFilesFromListing({
      listing,
      repoRoot,
      projectRoot: path.dirname(tsconfigFile),
      path,
    })
  })

const bySide = <A>(side: Side, main: A, branch: A): A => side === 'main' ? main : branch

const serviceOf = (side: Side): string => bySide(side, MAIN_SERVICE, BRANCH_SERVICE)

const sideInputOf =
  (input: ProjectInput, wires: ReadonlyArray<Checker.CheckerMutantWire>) => (side: Side): SideInput => ({
    side,
    project: input.project,
    tsconfigFile: input.tsconfigFile,
    repoRoot: input.repoRoot,
    workerPath: bySide(side, input.mainWorker, input.branchWorker),
    bundleHash: bySide(side, input.mainBundleHash, input.branchBundleHash),
    cacheDir: input.cacheDir,
    blockMutants: input.blockMutants,
    wires,
    receiver: input.receiver,
    serviceName: serviceOf(side),
    deadline: input.deadline,
  })

const telemetryLineOf = (
  input: ProjectInput,
  run: { readonly side: Side; readonly expectedCheckSpans: number },
  mutantIds: HashSet.HashSet<string>,
): Effect.Effect<ReadonlyArray<TelemetryMissing>> =>
  Effect.map(input.receiver.spans, (spans) => {
    const received = projectCheckSpans(spans, serviceOf(run.side), mutantIds).length
    return received < run.expectedCheckSpans
      ? [
        TelemetryMissing.make({
          schemaVersion: 1,
          side: run.side,
          project: input.project,
          expectedSpans: run.expectedCheckSpans,
          receivedSpans: received,
        }),
      ]
      : []
  })

const instrumentFiles = (
  repoRoot: string,
  project: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const sources = yield* Effect.forEach(
      files,
      (file) =>
        Effect.map(readText(path.resolve(repoRoot, file)), (content) => ({ name: file, content, mutate: true })),
    )
    const instrumented = yield* Instrument.instrument(sources, instrumenterOptions).pipe(
      Effect.mapError((cause) =>
        ioFailure(
          `Instrumenting ${sources.length} file(s) of ${project} failed: ${cause.message}`,
          'Fix what the branch instrumenter reports for this project.',
        )
      ),
    )
    return instrumented.mutants.map(toWire)
  })

interface ScopedWires {
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly changedFiles: number
  readonly changedMutants: number
  readonly sampledMutants: number
}

const instrumentNonEmpty = (
  input: ProjectInput,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Boolean.match(Arr.isReadonlyArrayNonEmpty(files), {
    onTrue: () => instrumentFiles(input.repoRoot, input.project, files),
    onFalse: () => Effect.succeed(Arr.empty<Checker.CheckerMutantWire>()),
  })

const planStaleFiles = (input: ProjectInput, fileName: string, planned: number, actual: number): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'plan-stale',
    reason:
      `The plan allocates ${planned} mutant(s) of ${fileName} in ${input.project}, but instrumenting it produced ${actual}.`,
    nextAction:
      'The plan and the leg instrumented different sources: rerun the whole workflow so the plan step re-instruments the corpus.',
  })

const blocksInUnit = (
  fileWires: ReadonlyArray<Checker.CheckerMutantWire>,
  unit: PlannedUnit,
  blockMutants: number,
): ReadonlyArray<Checker.CheckerMutantWire> =>
  blocksOf(fileWires, blockMutants).slice(unit.fromBlock, unit.toBlock).flat()

const plannedWiresOf = (
  input: ProjectInput,
  units: ReadonlyArray<PlannedUnit>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const byFile = Arr.sortWith(
      Object.entries(Arr.groupBy(units, (unit) => unit.fileName)),
      ([fileName]) => fileName,
      Str.Order,
    )
    const chunks = yield* Effect.forEach(
      byFile,
      ([fileName, fileUnits]) =>
        Effect.flatMap(instrumentFiles(input.repoRoot, input.project, [fileName]), (fileWires) => {
          const planned = Arr.headNonEmpty(fileUnits).fileMutants
          return Boolean.match(planned === fileWires.length, {
            onTrue: () =>
              Effect.succeed(fileUnits.flatMap((unit) => blocksInUnit(fileWires, unit, input.blockMutants))),
            onFalse: () => Effect.fail(planStaleFiles(input, fileName, planned, fileWires.length)),
          })
        }),
    )
    return chunks.flat()
  })

const plannedScope = (
  input: ProjectInput,
  units: ReadonlyArray<PlannedUnit>,
): Effect.Effect<ScopedWires, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    plannedWiresOf(input, units),
    (wires) => ({ wires, changedFiles: 0, changedMutants: 0, sampledMutants: 0 }),
  )

interface SampleFile {
  readonly file: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
}

const firstFileWithMutants = (
  input: ProjectInput,
  candidates: ReadonlyArray<string>,
): Effect.Effect<Option.Option<SampleFile>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Arr.match(candidates, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([file, ...rest]) =>
      Effect.flatMap(instrumentFiles(input.repoRoot, input.project, [file]), (wires) =>
        Boolean.match(Arr.isReadonlyArrayNonEmpty(wires), {
          onTrue: () =>
            Effect.succeedSome({ file, wires }),
          onFalse: () => firstFileWithMutants(input, rest),
        })),
  })

const samplesOnThisLeg = (input: ProjectInput): boolean =>
  Option.exists(
    input.pullRequest,
    (pullRequest) => Option.contains(HashMap.get(pullRequest.driftLegs, input.project), shardIndex(input.shard)),
  )

const changedOnThisLeg = (input: ProjectInput, pullRequest: PullRequestScope) => (file: string): boolean =>
  HashSet.has(pullRequest.changedFiles, file) && inShard(file, input.shard)

const pullRequestScope = (
  input: ProjectInput,
  owned: ReadonlyArray<string>,
  pullRequest: PullRequestScope,
): Effect.Effect<ScopedWires, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const changed = owned.filter(changedOnThisLeg(input, pullRequest))
    const changedWires = yield* instrumentNonEmpty(input, changed)
    const sample = yield* Boolean.match(samplesOnThisLeg(input), {
      onTrue: () => firstFileWithMutants(input, seededOrder(pullRequest.settings, owned)),
      onFalse: () => Effect.succeedNone,
    })
    const mutants = Arr.dedupeWith(
      [
        ...changedWires,
        ...Option.match(sample, {
          onNone: () => Arr.empty<Checker.CheckerMutantWire>(),
          onSome: (found) => found.wires,
        }),
      ],
      (left: Checker.CheckerMutantWire, right: Checker.CheckerMutantWire) => left.id === right.id,
    )
    const selected = yield* Effect.fromResult(
      selectScope(
        SelectScopeCommand.make({
          changedFiles: changed,
          sampleFile: Option.getOrNull(Option.map(sample, (found) => found.file)),
          mutants,
          settings: pullRequest.settings,
        }),
      ),
    )
    return Match.valueTags(selected, {
      ScopeSelected: (scope): ScopedWires => ({
        wires: scope.wires,
        changedFiles: changed.length,
        changedMutants: scope.changed.length,
        sampledMutants: scope.sampled.length,
      }),
      NothingSelected: (): ScopedWires => ({
        wires: [],
        changedFiles: changed.length,
        changedMutants: 0,
        sampledMutants: 0,
      }),
    })
  })

const checkBothSides = (
  input: ProjectInput,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<
  Pick<ProjectResult, 'lines' | 'status' | 'cachedFiles' | 'freshFiles'>,
  DriverFailure,
  Worker.WorkerLauncher | DriverServices
> =>
  Effect.gen(function*() {
    const sideInputs = Side.literals.map(sideInputOf(input, wires))
    const [runs, typeQueryLines] = yield* Effect.all([
      Effect.forEach(
        sideInputs,
        (sideInput) => Effect.map(runSide(sideInput), (run) => ({ ...run, side: sideInput.side })),
        { concurrency: 'unbounded' },
      ),
      Effect.flatMap(fileContentsOf(input, wires), (contents) => branchTypeQueryLines(input, contents, wires)),
    ], { concurrency: 'unbounded' })
    const mutantIds = HashSet.fromIterable(wires.map((wire) => wire.id))
    const telemetry = yield* Effect.forEach(
      runs.filter((run) => !run.bootFailed),
      (run) => telemetryLineOf(input, run, mutantIds),
    )
    return {
      lines: [...runs.flatMap((run) => run.lines), ...telemetry.flat(), ...typeQueryLines],
      status: runs.some((run) => run.bootFailed) ? 'boot-failed' : 'ran',
      cachedFiles: runs.reduce((total, run) => total + run.cachedFiles, 0),
      freshFiles: runs.reduce((total, run) => total + run.freshFiles, 0),
    }
  })

const projectDirectoryOf = (project: string): string => project.slice(0, project.lastIndexOf('/') + 1)

const inScopeOf = (input: ProjectInput): boolean =>
  Option.match(input.pullRequest, {
    onNone: () => true,
    onSome: (pullRequest) =>
      samplesOnThisLeg(input) ||
      HashSet.some(
        pullRequest.changedFiles,
        (file) => file.startsWith(projectDirectoryOf(input.project)) && inShard(file, input.shard),
      ),
  })

const checkedProject = (
  input: ProjectInput,
  scoped: ScopedWires,
  listAndInstrumentMs: number,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | DriverServices> => {
  const counted: ProjectResult = {
    ...EMPTY_RESULT,
    mutants: scoped.wires.length,
    changedFiles: scoped.changedFiles,
    changedMutants: scoped.changedMutants,
    sampledMutants: scoped.sampledMutants,
    listAndInstrumentMs,
  }
  return Boolean.match(Arr.isReadonlyArrayNonEmpty(scoped.wires), {
    onTrue: () =>
      Effect.map(
        Effect.timed(checkBothSides(input, scoped.wires)),
        ([elapsed, checked]): ProjectResult => ({ ...counted, ...checked, workersMs: Duration.toMillis(elapsed) }),
      ),
    onFalse: () =>
      Effect.succeed({
        ...counted,
        lines: skippedProject(input.project, 'no mutants in scope on this leg').lines,
        status: 'skipped',
      }),
  })
}

const scopedWiresOf = (
  input: ProjectInput,
  pullRequest: PullRequestScope,
): Effect.Effect<ScopedWires, DriverFailure, DriverServices> =>
  Effect.flatMap(
    listProgramFiles(input.tsconfigFile, input.repoRoot),
    (owned) => pullRequestScope(input, owned, pullRequest),
  )

const deferredProject = (input: ProjectInput): ProjectResult => ({
  ...EMPTY_RESULT,
  lines: [
    Deferred.make({
      schemaVersion: 1,
      side: null,
      project: input.project,
      fileName: null,
      mutants: 0,
      reason: 'deadline-passed',
    }),
  ],
  status: 'deferred',
})

const startedProject = (
  input: ProjectInput,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | DriverServices> =>
  Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis
    yield* Console.error(
      `checker-parity heartbeat +${seconds(now - input.deadline.startedAt)} project ${input.project}`,
    )
    const [prepared, scoped] = yield* Effect.timed(
      Option.match(input.plannedUnits, {
        onSome: (units) => plannedScope(input, units),
        onNone: () =>
          Option.match(input.pullRequest, {
            onSome: (pullRequest) => scopedWiresOf(input, pullRequest),
            onNone: () => plannedScope(input, []),
          }),
      }),
    )
    return yield* checkedProject(input, scoped, Duration.toMillis(prepared))
  })

const processProject = (
  input: ProjectInput,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | DriverServices> =>
  Boolean.match(inScopeOf(input), {
    onFalse: () => Effect.succeed(EMPTY_RESULT),
    onTrue: () =>
      Effect.flatMap(remainingOf(input.deadline), (remaining) =>
        Boolean.match(isPastDeadline(remaining), {
          onTrue: () => Effect.succeed(deferredProject(input)),
          onFalse: () => startedProject(input),
        })),
  })

const isPhaseLine = S.is(PhaseLine)

const phaseMsOf = (lines: ReadonlyArray<ParityLine>, side: Side): number =>
  lines.filter(isPhaseLine)
    .filter((line) => line.side === side && !line.cached)
    .reduce((total, line) => total + line.ms, 0)

const countWith = (results: ReadonlyArray<ProjectResult>, status: ProjectStatus): number =>
  results.filter((result) => result.status === status).length

const sumOf = (results: ReadonlyArray<ProjectResult>, of: (result: ProjectResult) => number): number =>
  results.reduce((total, result) => total + of(result), 0)

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

const shardSummary = (scope: LegScope, results: ReadonlyArray<ProjectResult>): string =>
  [
    `### checker-parity leg ${scope.shard} (${scope.scope === 'pr' ? 'pull request scope' : 'full corpus'})`,
    '',
    ...Option.match(Option.fromNullishOr(scope.settings), {
      onNone: Arr.empty<string>,
      onSome: (settings) => [
        `Scope settings: seed \`${settings.seed}\`; drift ${settings.perProject} mutant(s) per project over ${settings.driftProjects} project(s); at most ${settings.perChangedFile} mutant(s) per changed file.`,
        '',
      ],
    }),
    '| projects run | skipped | boot-failed | changed files | changed mutants | sampled mutants | checked mutants | files from cache | files checked | discovery | list + instrument | workers | main check | branch check | wall |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${scope.projects} | ${countWith(results, 'skipped')} | ${
      countWith(results, 'boot-failed')
    } | ${scope.changedFiles} | ${scope.changedMutants} | ${scope.sampledMutants} | ${scope.checkedMutants} | ${scope.cachedFiles} | ${scope.freshFiles} | ${
      seconds(scope.corpusDiscoveryMs)
    } | ${seconds(scope.listAndInstrumentMs)} | ${seconds(scope.workersMs)} | ${
      seconds(sumOf(results, (result) => phaseMsOf(result.lines, 'main')))
    } | ${seconds(sumOf(results, (result) => phaseMsOf(result.lines, 'branch')))} | ${seconds(scope.wallMs)} |`,
    '',
  ].join('\n')

const requireWorker = (
  [flag, workerPath]: readonly [string, string],
): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.flatMap(exists(workerPath), (present) =>
    Boolean.match(present, {
      onTrue: () => Effect.void,
      onFalse: () =>
        Effect.fail(
          DriverFailure.make({
            schemaVersion: 1,
            code: 'worker-boot-failed',
            reason: `${flag} ${workerPath} does not exist`,
            nextAction: `Build the checker so ${workerPath} exists.`,
          }),
        ),
    }))

const corpusProjects = (repoRoot: string): Effect.Effect<ReadonlyArray<string>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const entries = corpusEntries(yield* gitTrackedFiles(repoRoot))
    const e2eProjects = yield* Effect.forEach(
      entries.e2eConfigs,
      (configPath) =>
        Effect.map(
          readText(path.resolve(repoRoot, configPath)),
          (configText) => tsconfigsNamedByConfig({ configText, configDirectory: path.dirname(configPath), path }),
        ),
    )
    return Arr.sort(
      Arr.dedupe([...entries.workspaceTsconfigs, ...e2eProjects.flat(), ISOLATED_DECLARATIONS_PROJECT]),
      Str.Order,
    )
  })

const usageFailure = (reason: string, nextAction: string): DriverFailure =>
  DriverFailure.make({ schemaVersion: 1, code: 'usage-error', reason, nextAction })

const decodeSettings = S.decodeResult(S.fromJsonString(ScopeSettings))

const driftLegsOf = (
  settings: ScopeSettings,
  projects: ReadonlyArray<string>,
  shards: number,
): Effect.Effect<HashMap.HashMap<string, number>> =>
  Effect.map(
    Effect.fromResult(assignDriftLegs(AssignDriftLegsCommand.make({ settings, projects: [...projects], shards }))),
    Match.valueTags({
      DriftLegsAssigned: (assigned) =>
        HashMap.fromIterable(assigned.projects.map((drift) => [drift.project, drift.leg] as const)),
      NoDriftProjects: () => HashMap.empty<string, number>(),
    }),
  )

const pullRequestScopeOf = (
  command: RunCommand,
  repoRoot: string,
  projects: ReadonlyArray<string>,
): Effect.Effect<Option.Option<PullRequestScope>, DriverFailure, DriverServices> =>
  Match.value(command.scope).pipe(
    Match.when('full', () => Effect.succeedNone),
    Match.when('pr', () =>
      Effect.gen(function*() {
        const base = yield* Effect.fromOption(command.base).pipe(
          Effect.mapError(() => usageFailure('--scope pr needs --base', 'Pass --base <merge-base sha>.')),
        )
        const settingsFile = yield* Effect.fromOption(command.settings).pipe(
          Effect.mapError(() =>
            usageFailure('--scope pr needs --settings', 'Pass --settings test/checker-parity/pr-scope.json.')
          ),
        )
        const settings = yield* Effect.fromResult(
          Result.mapError(
            decodeSettings(yield* readText(settingsFile)),
            (issue) =>
              usageFailure(`${settingsFile} is not a scope settings file: ${issue.message}`, `Fix ${settingsFile}.`),
          ),
        )
        const changed = yield* changedFiles({ base, repoRoot })
        return Option.some({
          changedFiles: HashSet.fromIterable(changed),
          settings,
          driftLegs: yield* driftLegsOf(settings, projects, shardCount(command.shard)),
        })
      })),
    Match.exhaustive,
  )

const legScopeOf = (
  command: RunCommand,
  pullRequest: Option.Option<PullRequestScope>,
  results: ReadonlyArray<ProjectResult>,
  timings: { readonly corpusDiscoveryMs: number; readonly wallMs: number },
): LegScope =>
  LegScope.make({
    schemaVersion: 1,
    shard: command.shard,
    scope: command.scope,
    settings: Option.getOrNull(Option.map(pullRequest, (scope) => scope.settings)),
    changedFiles: sumOf(results, (result) => result.changedFiles),
    changedMutants: sumOf(results, (result) => result.changedMutants),
    sampledMutants: sumOf(results, (result) => result.sampledMutants),
    checkedMutants: sumOf(results, (result) => result.mutants),
    projects: countWith(results, 'ran') + countWith(results, 'boot-failed'),
    cachedFiles: sumOf(results, (result) => result.cachedFiles),
    freshFiles: sumOf(results, (result) => result.freshFiles),
    corpusDiscoveryMs: timings.corpusDiscoveryMs,
    listAndInstrumentMs: sumOf(results, (result) => result.listAndInstrumentMs),
    workersMs: sumOf(results, (result) => result.workersMs),
    wallMs: timings.wallMs,
  })

const encodeLegFile = S.encodeResult(S.fromJsonString(LegFile))

const writeLegFile = (file: string, leg: LegFile): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.flatMap(
    Effect.fromResult(
      Result.mapError(
        encodeLegFile(leg),
        (issue) =>
          ioFailure(`Could not encode the leg scope: ${issue.message}`, 'Inspect LegFile in Parity.schema.ts.'),
      ),
    ),
    (text) => writeText(file, text),
  )

export const corpusMutantCounts = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<CorpusFile>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const projects = yield* corpusProjects(repoRoot)
    const counts = yield* Effect.forEach(projects, (project) =>
      Effect.flatMap(exists(`${repoRoot}/${project}`), (present) =>
        Boolean.match(present, {
          onTrue: () =>
            Effect.flatMap(
              listProgramFiles(`${repoRoot}/${project}`, repoRoot),
              (files) =>
                Effect.map(instrumentFiles(repoRoot, project, files), (wires) => {
                  const counted = HashMap.fromIterable(
                    Object.entries(Arr.groupBy(wires, (wire) =>
                      wire.fileName)).map(
                        ([fileName, owned]) => [String(fileName), owned.length] as const,
                      ),
                  )
                  return files.map((fileName) =>
                    CorpusFile.make({
                      project,
                      fileName,
                      mutants: Option.getOrElse(HashMap.get(counted, fileName), () => 0),
                    })
                  )
                }),
            ),
          onFalse: () => Effect.succeed(Arr.empty<CorpusFile>()),
        })))
    return counts.flat()
  })

interface LegPlan {
  readonly units: HashMap.HashMap<string, ReadonlyArray<PlannedUnit>>
  readonly blockMutants: number
  readonly summary: string
}

const costSourcesOf = (leg: PlannedLeg): string => {
  const counts = Arr.groupBy(leg.units, (unit) => unit.source)
  return Object.entries(counts).map(([source, units]) => `${source}: ${units.length}`).join(', ')
}

const planSummaryOf = (plan: ParityPlan, leg: PlannedLeg): string =>
  `Planned ${seconds(leg.ms)} of ${seconds(plan.capacityMs)} capacity over ${leg.units.length} unit(s) (${
    costSourcesOf(leg)
  }); every leg: ${plan.legs.map((planned) => seconds(planned.ms)).join(', ')} (total ${seconds(plan.totalMs)}).`

const planStale = (reason: string, nextAction: string): DriverFailure =>
  DriverFailure.make({ schemaVersion: 1, code: 'plan-stale', reason, nextAction })

const legPlanFrom = (command: RunCommand, plan: ParityPlan): Effect.Effect<LegPlan, DriverFailure> =>
  Boolean.match(plan.legs.length === shardCount(command.shard), {
    onTrue: () =>
      Option.match(Arr.findFirst(plan.legs, (leg) => leg.leg === shardIndex(command.shard)), {
        onNone: () =>
          Effect.fail(
            planStale(
              `The plan has no leg ${shardIndex(command.shard)} although it has ${shardCount(command.shard)} leg(s).`,
              'The plan and the matrix disagree on the leg numbers: rerun the whole workflow so the plan step and the matrix are built from the same run.',
            ),
          ),
        onSome: (leg) =>
          Effect.succeed(
            {
              units: HashMap.fromIterable(Object.entries(Arr.groupBy(leg.units, (unit) => unit.project))),
              blockMutants: plan.blockMutants,
              summary: planSummaryOf(plan, leg),
            } satisfies LegPlan,
          ),
      }),
    onFalse: () =>
      Effect.fail(
        planStale(
          `The plan has ${plan.legs.length} leg(s), but this run dispatches ${shardCount(command.shard)}.`,
          'The matrix width and the plan disagree: rerun the whole workflow so the plan step and the matrix are built from the same run.',
        ),
      ),
  })

const decodeParityPlan = S.decodeResult(S.fromJsonString(ParityPlan))

const planOf = (
  command: RunCommand,
): Effect.Effect<Option.Option<LegPlan>, DriverFailure, FileSystem.FileSystem> =>
  Match.value(command.scope).pipe(
    Match.when('pr', () => Effect.succeedNone),
    Match.when('full', () =>
      Effect.gen(function*() {
        const planFile = yield* Effect.fromOption(command.plan).pipe(
          Effect.mapError(() =>
            usageFailure(
              'Full scope needs --plan pointing at the checker-parity-plan.json this run wrote.',
              'Pass --plan <path>; --scope full cannot recompute its leg layout.',
            )
          ),
        )
        const plan = yield* Effect.flatMap(readText(planFile), (text) =>
          Effect.fromResult(
            Result.mapError(decodeParityPlan(text), (issue) =>
              DriverFailure.make({
                schemaVersion: 1,
                code: 'decode-failed',
                reason: `${planFile} is not a parity plan: ${issue.message}`,
                nextAction:
                  'Point --plan at the checker-parity-plan.json artifact of this run, or rerun the workflow so the plan step writes it again.',
              })),
          ))
        return Option.some(yield* legPlanFrom(command, plan))
      })),
    Match.exhaustive,
  )

const deferredIn = (results: ReadonlyArray<ProjectResult>): ReadonlyArray<Deferred> =>
  results.flatMap((result) => result.lines).filter((line): line is Deferred => S.is(Deferred)(line))

const freshBatchesIn = (results: ReadonlyArray<ProjectResult>): number =>
  results.flatMap((result) => result.lines).filter((line) => S.is(CacheEntry)(line) && !line.hit).length

const legDeadlineFailure = (
  command: RunCommand,
  deferred: Arr.NonEmptyReadonlyArray<Deferred>,
  freshBatches: number,
): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'leg-deadline',
    reason: `Leg ${command.shard} reached its ${
      Option.getOrElse(command.deadline, () => 0)
    } s deadline: ${freshBatches} batch(es) were checked and cached this attempt; ${
      deferred.filter((line) => line.fileName !== null).length
    } file run(s) (${deferred.reduce((total, line) => total + line.mutants, 0)} mutant(s)) and ${
      deferred.filter((line) => line.fileName === null).length
    } project(s) are deferred (${
      deferred.filter((line) => line.reason === 'interrupted-at-deadline').length
    } interrupted).`,
    nextAction:
      'Rerun the failed leg. Cached batches are reused, so the rerun starts at the first deferred batch; a batch the deadline interrupts twice is recorded as UnitOverBudget and compare names it (code unit-over-budget).',
  })

type ShardRun = Effect.Effect<void, DriverFailure, Worker.WorkerLauncher | DriverServices>

export const runShard: {
  (environment: CiEnvironment): (command: RunCommand) => ShardRun
  (command: RunCommand, environment: CiEnvironment): ShardRun
} = dual(2, (command: RunCommand, environment: CiEnvironment): ShardRun =>
  Effect.scoped(
    Effect.gen(function*() {
      const started = yield* Clock.currentTimeMillis
      const deadline: LegDeadline = {
        startedAt: started,
        deadlineAt: Option.map(command.deadline, (limit) => started + limit * 1000),
      }
      const path = yield* Path.Path
      const repoRoot = path.resolve('.')
      yield* Effect.forEach(
        [['--main-worker', command.mainWorker], ['--branch-worker', command.branchWorker]] as const,
        requireWorker,
        { discard: true },
      )
      const receiver = yield* startOtlpReceiver
      const [discovery, { mainBundleHash, branchBundleHash, projects, pullRequest, plan }] = yield* Effect.timed(
        Effect.gen(function*() {
          const projects = yield* corpusProjects(repoRoot)
          return {
            mainBundleHash: yield* sha256Tree(path.dirname(command.mainWorker)),
            branchBundleHash: yield* sha256Tree(path.dirname(command.branchWorker)),
            projects,
            pullRequest: yield* pullRequestScopeOf(command, repoRoot, projects),
            plan: yield* planOf(command),
          }
        }),
      )
      const planSummary = Option.match(plan, { onNone: () => '', onSome: (planned) => planned.summary })
      const blockMutants = Option.match(plan, {
        onNone: () => DEFAULT_BLOCK_MUTANTS,
        onSome: (planned) => planned.blockMutants,
      })
      yield* Console.error(`checker-parity leg ${command.shard}: ${planSummary}`)
      const cacheDir = path.resolve(repoRoot, command.cache)
      const outDir = path.resolve(repoRoot, command.out)
      const shardFile = path.join(outDir, `shard-${shardIndex(command.shard)}.ndjson`)
      const scopeFile = path.join(outDir, `scope-${shardIndex(command.shard)}.json`)
      yield* makeDirectory(outDir)
      yield* writeText(shardFile, '')
      yield* writeLegFile(
        scopeFile,
        LegStarted.make({
          schemaVersion: 1,
          shard: command.shard,
          scope: command.scope,
          settings: Option.getOrNull(Option.map(pullRequest, (scope) => scope.settings)),
          projects,
          corpusDiscoveryMs: Duration.toMillis(discovery),
        }),
      )
      const servers = yield* Ref.make<ServerTally>({ live: 0, peak: 0 })
      const results = yield* Effect.forEach(projects, (project) => {
        const tsconfigFile = path.resolve(repoRoot, project)
        return Effect.flatMap(exists(tsconfigFile), (present) =>
          Boolean.match(present, {
            onTrue: () =>
              processProject({
                project,
                tsconfigFile,
                repoRoot,
                shard: command.shard,
                pullRequest,
                plannedUnits: Option.map(
                  plan,
                  (planned) => Option.getOrElse(HashMap.get(planned.units, project), () => Arr.empty<PlannedUnit>()),
                ),
                blockMutants,
                cacheDir,
                mainWorker: command.mainWorker,
                branchWorker: command.branchWorker,
                mainBundleHash,
                branchBundleHash,
                servers,
                receiver,
                deadline,
              }),
            onFalse: () => Effect.succeed(skippedProject(project, `tsconfig not found at ${project}`)),
          })).pipe(
            Effect.tap((result) => Effect.flatMap(ndjsonOf(result.lines), (ndjson) => appendText(shardFile, ndjson))),
          )
      })
      const finished = yield* Clock.currentTimeMillis
      const scope = legScopeOf(command, pullRequest, results, {
        corpusDiscoveryMs: Duration.toMillis(discovery),
        wallMs: finished - started,
      })
      yield* appendStepSummary(environment, `${shardSummary(scope, results)}${planSummary}\n`)
      yield* Arr.match(deferredIn(results), {
        onEmpty: () => writeLegFile(scopeFile, scope),
        onNonEmpty: (deferred) => Effect.fail(legDeadlineFailure(command, deferred, freshBatchesIn(results))),
      })
    }),
  ))
