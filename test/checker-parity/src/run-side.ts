import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Worker } from '@systemfsoftware/stryker-js'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, type Mutant, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
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
import * as Result from 'effect/Result'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { appendStepSummary, type CiEnvironment, readsCache } from './ci-environment.js'
import {
  corpusEntries,
  ISOLATED_DECLARATIONS_PROJECT,
  programFilesFromListing,
  tsconfigsNamedByConfig,
} from './corpus.js'
import { DriverFailure } from './DriverFailure.schema.js'
import { execText } from './exec-text.js'
import { type OtlpReceiver, startOtlpReceiver } from './otlp-receiver.js'
import {
  CacheEntry,
  CheckCall,
  Counts,
  DigestCall,
  GroupCall,
  ParityLine,
  PhaseLine,
  ProjectBootFailed,
  ProjectSkipped,
  type Shard,
  shardIndex,
  Side,
  TelemetryMissing,
  Verdict,
} from './Parity.schema.js'
import {
  reuseCachedVerdicts,
  ReuseCachedVerdictsCommand,
  VerdictCacheIdentity,
} from './reuse-cached-verdicts.workflow.js'
import { inShard } from './shard.js'
import { COUNTS_SCHEMA_VERSION, countsOfSpans, countsSchemaVersionsOf, projectCheckSpans } from './span-counts.js'

const decodeParityLine = S.decodeResult(S.fromJsonString(ParityLine))
const encodeParityLine = S.encodeResult(S.fromJsonString(ParityLine))
const decodeTypescriptPackage = S.decodeResult(
  S.fromJsonString(S.Struct({ bin: S.optional(S.Struct({ tsc: S.optional(S.String) })) })),
)

export interface RunCommand {
  readonly mainWorker: string
  readonly branchWorker: string
  readonly shard: Shard
  readonly cache: string
  readonly out: string
}

export type DriverServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

const MAIN_SERVICE = 'checker-parity-main'
const BRANCH_SERVICE = 'checker-parity-branch'
const CHECKER_NAME = 'typescript'
const DRAIN = Duration.millis(500)

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

interface SideInput {
  readonly side: Side
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly workerPath: string
  readonly bundleHash: string
  readonly cacheDir: string
  readonly readCache: boolean
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly receiver: OtlpReceiver
  readonly serviceName: string
}

interface SideRun {
  readonly bootFailed: boolean
  readonly lines: ReadonlyArray<ParityLine>
  readonly expectedCheckSpans: number
}

const cachedLine = (line: ParityLine): Option.Option<ParityLine> =>
  S.is(Verdict)(line)
    ? Option.some(
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
      }),
    )
    : Option.liftPredicate(line, S.is(Counts))

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

const branchCountsLine = (input: SideInput): Effect.Effect<Counts, DriverFailure> =>
  Effect.gen(function*() {
    yield* Effect.sleep(DRAIN)
    const checkSpans = projectCheckSpans(
      yield* input.receiver.spans,
      input.serviceName,
      HashSet.fromIterable(input.wires.map((wire) => wire.id)),
    )
    yield* Option.match(
      Arr.findFirst(countsSchemaVersionsOf(checkSpans), (version) => version !== COUNTS_SCHEMA_VERSION),
      {
        onNone: () => Effect.void,
        onSome: (version) => Effect.fail(unsupportedVersion(version)),
      },
    )
    return Counts.make({ schemaVersion: 1, side: 'branch', project: input.project, ...countsOfSpans(checkSpans) })
  })

interface CacheSlot {
  readonly key: string
  readonly verdictsFile: string
  readonly identityFile: string
  readonly identity: VerdictCacheIdentity
}

const encodeIdentity = S.encodeResult(S.fromJsonString(VerdictCacheIdentity))
const decodeIdentity = S.decodeResult(S.fromJsonString(VerdictCacheIdentity))

const cacheSlotOf = (input: SideInput, identity: VerdictCacheIdentity): Effect.Effect<CacheSlot, never, Path.Path> =>
  Path.Path.useSync((path) => {
    const key = bytesToHex(sha256(utf8ToBytes(input.project)))
    return {
      key,
      verdictsFile: path.join(input.cacheDir, `${input.side}-${key}.ndjson`),
      identityFile: path.join(input.cacheDir, `${input.side}-${key}.identity.json`),
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

const cacheEntry = (input: SideInput, key: string, hit: boolean): CacheEntry =>
  CacheEntry.make({ schemaVersion: 1, side: input.side, project: input.project, key, hit })

const freshSideRun = (
  input: SideInput,
  slot: CacheSlot,
  lines: ReadonlyArray<ParityLine>,
  groups: number,
): Effect.Effect<SideRun, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const identityText = yield* Effect.fromResult(
      Result.mapError(encodeIdentity(slot.identity), (issue) =>
        ioFailure(`Could not encode the verdict cache identity: ${issue.message}`, 'Inspect VerdictCacheIdentity.')),
    )
    yield* makeDirectory(input.cacheDir)
    yield* FileSystem.FileSystem.use((fs) =>
      fs.remove(slot.identityFile, { force: true })
    ).pipe(
      Effect.mapError((cause) => ioFailure(cause.message, `Check ${input.cacheDir} is writable.`)),
    )
    yield* writeText(slot.verdictsFile, yield* ndjsonOf(lines))
    yield* writeText(slot.identityFile, identityText)
    return { bootFailed: false, lines: [cacheEntry(input, slot.key, false), ...lines], expectedCheckSpans: groups }
  })

const checkGroup = (
  client: CheckerClient,
  input: SideInput,
  wireById: HashMap.HashMap<string, Checker.CheckerMutantWire>,
) =>
(
  group: ReadonlyArray<string>,
  callIndex: number,
): Effect.Effect<ReadonlyArray<ParityLine>, Checker.CheckerFailed | RpcClientError> =>
  Effect.gen(function*() {
    const groupWires = Arr.getSomes(group.map((id) => HashMap.get(wireById, id)))
    const [checkDuration, results] = yield* Effect.timed(
      client.check({ checkerName: CHECKER_NAME, mutants: [...groupWires] }),
    )
    const call = CheckCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      callIndex,
      mutantIds: [...group],
      ms: Duration.toMillis(checkDuration),
      cached: false,
    })
    const verdicts = Arr.getSomes(
      groupWires.map((wire) =>
        Option.map(Option.fromUndefinedOr(results[wire.id]), (result) => verdictOf(input, wire, result))
      ),
    )
    return [call, ...verdicts]
  })

const freshlyChecked = (
  client: CheckerClient,
  input: SideInput,
  slot: CacheSlot,
  digestLine: DigestCall,
): Effect.Effect<SideRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const [groupDuration, groups] = yield* Effect.timed(
      client.group({ checkerName: CHECKER_NAME, mutants: [...input.wires] }),
    )
    const wireById = HashMap.fromIterable(input.wires.map((wire) => [wire.id, wire] as const))
    const groupLines = yield* Effect.forEach(groups, checkGroup(client, input, wireById))
    const branchLines = yield* Boolean.match(input.side === 'branch', {
      onTrue: () => Effect.map(branchCountsLine(input), Arr.of),
      onFalse: () => Effect.succeed(Arr.empty<Counts>()),
    })
    const groupLine = GroupCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      ms: Duration.toMillis(groupDuration),
      groups: groups.length,
      cached: false,
    })
    return yield* freshSideRun(
      input,
      slot,
      [digestLine, groupLine, ...groupLines.flat(), ...branchLines],
      groups.length,
    )
  })

const sideBody = (
  client: CheckerClient,
  input: SideInput,
): Effect.Effect<SideRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const [digestDuration, digest] = yield* Effect.timed(client.digest({ checkerName: CHECKER_NAME }))
    const slot = yield* cacheSlotOf(
      input,
      VerdictCacheIdentity.make({
        schemaVersion: 1,
        bundleHash: input.bundleHash,
        programDigest: digest,
        wires: [...input.wires],
      }),
    )
    const reuse = yield* Effect.fromResult(
      reuseCachedVerdicts(
        ReuseCachedVerdictsCommand.make({
          readCache: input.readCache,
          current: slot.identity,
          stored: yield* storedIdentityOf(slot),
        }),
      ),
    )
    const digestLine = DigestCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      ms: Duration.toMillis(digestDuration),
      digest,
      cached: false,
    })
    return yield* Match.valueTags(reuse, {
      VerdictsReused: () =>
        Effect.map(readCacheFile(slot.verdictsFile), (lines) => ({
          bootFailed: false,
          lines: [cacheEntry(input, slot.key, true), ...lines],
          expectedCheckSpans: 0,
        })),
      CheckFreshly: () => freshlyChecked(client, input, slot, digestLine),
    })
  })

const bootFailedRun = (input: SideInput, error: Worker.WorkerBootError): Effect.Effect<SideRun> =>
  Effect.succeed({
    bootFailed: true,
    lines: [
      ProjectBootFailed.make({ schemaVersion: 1, side: input.side, project: input.project, reason: error.message }),
    ],
    expectedCheckSpans: 0,
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
        tempDirPrefix: 'stryker-checker-',
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

interface ProjectInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly shard: Shard
  readonly cacheDir: string
  readonly readCache: boolean
  readonly mainWorker: string
  readonly branchWorker: string
  readonly mainBundleHash: string
  readonly branchBundleHash: string
  readonly receiver: OtlpReceiver
}

type ProjectStatus = 'ran' | 'skipped' | 'boot-failed'

interface ProjectResult {
  readonly lines: ReadonlyArray<ParityLine>
  readonly status: ProjectStatus
  readonly mutants: number
}

const skippedProject = (project: string, reason: string): ProjectResult => ({
  lines: [ProjectSkipped.make({ schemaVersion: 1, project, reason })],
  status: 'skipped',
  mutants: 0,
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

const listProgramFiles = (input: ProjectInput): Effect.Effect<ReadonlyArray<string>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const tsc = yield* tscBinPath
    const listing = yield* execText({
      file: globalThis.process.execPath,
      args: [tsc, '--listFilesOnly', '-p', input.tsconfigFile],
      cwd: input.repoRoot,
    })
    return programFilesFromListing({ listing, repoRoot: input.repoRoot, path })
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
    readCache: input.readCache,
    wires,
    receiver: input.receiver,
    serviceName: serviceOf(side),
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

const instrumentShard = (
  input: ProjectInput,
  shardFiles: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const files = yield* Effect.forEach(
      shardFiles,
      (file) =>
        Effect.map(readText(path.resolve(input.repoRoot, file)), (content) => ({ name: file, content, mutate: true })),
    )
    const instrumented = yield* Instrument.instrument(files, instrumenterOptions).pipe(
      Effect.mapError((cause) =>
        ioFailure(
          `Instrumenting ${files.length} file(s) of ${input.project} failed: ${cause.message}`,
          'Fix what the branch instrumenter reports for this project.',
        )
      ),
    )
    return instrumented.mutants.map(toWire)
  })

const checkBothSides = (
  input: ProjectInput,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const sideInputs = Side.literals.map(sideInputOf(input, wires))
    const runs = yield* Effect.forEach(
      sideInputs,
      (sideInput) => Effect.map(runSide(sideInput), (run) => ({ ...run, side: sideInput.side })),
    )
    const mutantIds = HashSet.fromIterable(wires.map((wire) => wire.id))
    const telemetry = yield* Effect.forEach(
      runs.filter((run) => !run.bootFailed),
      (run) => telemetryLineOf(input, run, mutantIds),
    )
    return {
      lines: [...runs.flatMap((run) => run.lines), ...telemetry.flat()],
      status: runs.some((run) => run.bootFailed) ? 'boot-failed' : 'ran',
      mutants: wires.length,
    }
  })

const processProject = (
  input: ProjectInput,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | DriverServices> =>
  Effect.gen(function*() {
    const shardFiles = (yield* listProgramFiles(input)).filter((file) => inShard(file, input.shard))
    const wires = yield* Boolean.match(Arr.isReadonlyArrayNonEmpty(shardFiles), {
      onTrue: () => instrumentShard(input, shardFiles),
      onFalse: () => Effect.succeed(Arr.empty<Checker.CheckerMutantWire>()),
    })
    return yield* Match.value({ files: shardFiles.length, mutants: wires.length }).pipe(
      Match.when({ files: 0 }, () => Effect.succeed(skippedProject(input.project, 'no program files in this shard'))),
      Match.when({ mutants: 0 }, () =>
        Effect.succeed(skippedProject(input.project, 'no mutants produced in this shard'))),
      Match.orElse(() =>
        checkBothSides(input, wires)
      ),
    )
  })

const isPhaseLine = S.is(PhaseLine)

const phaseMsOf = (lines: ReadonlyArray<ParityLine>, side: Side): number =>
  lines.filter(isPhaseLine)
    .filter((line) => line.side === side && !line.cached)
    .reduce((total, line) => total + line.ms, 0)

const countWith = (results: ReadonlyArray<ProjectResult>, status: ProjectStatus): number =>
  results.filter((result) => result.status === status).length

const shardSummary = (shard: Shard, results: ReadonlyArray<ProjectResult>): string => {
  const sum = (of: (result: ProjectResult) => number): number =>
    results.reduce((total, result) => total + of(result), 0)
  return [
    `### checker-parity shard ${shard}`,
    '',
    '| projects run | skipped | boot-failed | mutants | main check ms | branch check ms |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${results.length - countWith(results, 'skipped')} | ${countWith(results, 'skipped')} | ${
      countWith(results, 'boot-failed')
    } | ${sum((result) => result.mutants)} | ${sum((result) => phaseMsOf(result.lines, 'main'))} | ${
      sum((result) => phaseMsOf(result.lines, 'branch'))
    } |`,
    '',
  ].join('\n')
}

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

type ShardRun = Effect.Effect<void, DriverFailure, Worker.WorkerLauncher | DriverServices>

export const runShard: {
  (environment: CiEnvironment): (command: RunCommand) => ShardRun
  (command: RunCommand, environment: CiEnvironment): ShardRun
} = dual(2, (command: RunCommand, environment: CiEnvironment): ShardRun =>
  Effect.scoped(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const repoRoot = path.resolve('.')
      yield* Effect.forEach(
        [['--main-worker', command.mainWorker], ['--branch-worker', command.branchWorker]] as const,
        requireWorker,
        { discard: true },
      )
      const receiver = yield* startOtlpReceiver
      const mainBundleHash = yield* sha256Tree(path.dirname(command.mainWorker))
      const branchBundleHash = yield* sha256Tree(path.dirname(command.branchWorker))
      const projects = yield* corpusProjects(repoRoot)
      const cacheDir = path.resolve(repoRoot, command.cache)
      const outDir = path.resolve(repoRoot, command.out)
      const shardFile = path.join(outDir, `shard-${shardIndex(command.shard)}.ndjson`)
      yield* makeDirectory(outDir)
      yield* writeText(shardFile, '')
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
                cacheDir,
                readCache: readsCache(environment),
                mainWorker: command.mainWorker,
                branchWorker: command.branchWorker,
                mainBundleHash,
                branchBundleHash,
                receiver,
              }),
            onFalse: () => Effect.succeed(skippedProject(project, `tsconfig not found at ${project}`)),
          })).pipe(
            Effect.tap((result) => Effect.flatMap(ndjsonOf(result.lines), (ndjson) => appendText(shardFile, ndjson))),
          )
      })
      yield* appendStepSummary(environment, shardSummary(command.shard, results))
    }),
  ))
