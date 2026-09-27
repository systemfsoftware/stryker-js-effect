import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { witnessRegistry } from '@systemfsoftware/stryker-e2e-core'
import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

const LANE_LOCK = '/tmp/stryker-e2e-lane.lock'
const LANE_TIMEOUT_SECONDS = 1500
const LANE_TIMEOUT_ARGUMENT = String(LANE_TIMEOUT_SECONDS)
const LANE_KILL_AFTER = '10s'
const INSTALL_TIMEOUT_MS = 900_000
const COMMAND_SLACK_MS = 120_000
const DECODE_MAX_BUFFER = 256 * 1024 * 1024
const REPORTS_DIRECTORY = 'test/e2e/reports/seeded-faults'
const ARTIFACT_TRACES_DIRECTORY = 'test/e2e/artifacts/traces'
const JOURNEY_PREFIX = 'test/e2e/'
const JOURNEY_ARGUMENT_PREFIX = 'tests/'
const SCRATCH_PREFIX = 'seed-status-fault-'

interface Fault {
  readonly name: string
  readonly file: string
  readonly anchor: string
  readonly replacement: string
  /** What the assigned journey prints when it catches this misclassification; any other failure is the wrong reason. */
  readonly detection: RegExp
}

const FAULTS: Readonly<Record<Mutant.MutantStatus, Fault>> = {
  Killed: {
    name: 'Killed reported as Survived',
    detection: /annotated Killed but the run reported Survived/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: "reportMutant(mutant, 'Killed', {",
    replacement: "reportMutant(mutant, 'Survived', {",
  },
  Survived: {
    name: 'Survived reported as Killed',
    detection: /annotated Survived but the run reported Killed/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: "reportMutant(mutant, 'Survived', { testsCompleted: survived.nrOfTests })",
    replacement: "reportMutant(mutant, 'Killed', { testsCompleted: survived.nrOfTests })",
  },
  NoCoverage: {
    name: 'NoCoverage reported as Survived',
    detection: /annotated NoCoverage but the run reported Survived/u,
    file: 'packages/stryker-js/src/plan-mutant-tests.workflow.ts',
    anchor: "toEarlyResultPlan(mutant, isStatic, 'NoCoverage', undefined, coveringTestIdsOf(command, mutant.id))",
    replacement: "toEarlyResultPlan(mutant, isStatic, 'Survived', undefined, coveringTestIdsOf(command, mutant.id))",
  },
  CompileError: {
    name: 'CompileError reported with a reason naming no diagnostic',
    detection: /reported reason names no such cause: seeded status fault/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: "reportMutantStatus(mutant, 'CompileError', result.reason)",
    replacement: "reportMutantStatus(mutant, 'CompileError', 'seeded status fault: this reason names no diagnostic')",
  },
  RuntimeError: {
    name: 'RuntimeError reported as Survived',
    detection: /annotated RuntimeError\([^)]*\) but the run reported Survived/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: "reportMutant(mutant, 'RuntimeError', { statusReason: errored.errorMessage })",
    replacement: "reportMutant(mutant, 'Survived', { statusReason: errored.errorMessage })",
  },
  Timeout: {
    name: 'Timeout reported as Survived',
    detection: /\+\s*"timedOutIsNonEmpty": false/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: "reportMutant(mutant, 'Timeout', reasonedOutcomeOf(timedOut.reason))",
    replacement: "reportMutant(mutant, 'Survived', reasonedOutcomeOf(timedOut.reason))",
  },
  Ignored: {
    name: 'Directive-ignored mutant reported as Survived',
    detection: /annotated Ignored but the run reported Survived/u,
    file: 'packages/stryker-js-instrumenter/src/Mutator.service.ts',
    anchor: "{ ...baseFields, statusReason: mutant.ignoreReason, status: 'Ignored' }",
    replacement: "{ ...baseFields, statusReason: mutant.ignoreReason, status: 'Survived' }",
  },
  Pending: {
    name: 'Pending omitted from the interrupted checkpoint',
    detection: /\+\s*"pendingIsNonEmpty": false/u,
    file: 'packages/stryker-js/src/mutation-reporting.service.ts',
    anchor: 'onSuccess: (rows) => rows.map(checkpointResultOf),',
    replacement:
      "onSuccess: (rows) => rows.filter((row) => row._tag !== 'CheckpointPendingMutant').map(checkpointResultOf),",
  },
}

const STATUS_ORDER: ReadonlyArray<Mutant.MutantStatus> = Object.keys(FAULTS) as ReadonlyArray<Mutant.MutantStatus>

/**
 * The paths `U17Meta` owns in the same wave; a concurrent edit there must not read as a seeded-fault leak.
 */
const SIBLING_OWNED_PATHS: ReadonlyArray<RegExp> = [
  /^\.changeset\//u,
  /^docs\/solutions\//u,
  /^packages\/[^/]+\/etc\/[^/]+\.api\.md$/u,
  /^packages\/[^/]+\/README\.md$/u,
  /^README\.md$/u,
]

const TEST_FILES_FAILED = /Test Files\s+\d+ failed/u
const TESTS_FAILED = /Tests\s+\d+ failed/u
const LANE_TIMEOUT_EXIT_CODES: ReadonlyArray<number> = [124, 137]

type SeedResult = 'red' | 'wrong-reason' | 'not-red' | 'waived' | 'error'

interface StatusResult {
  readonly status: Mutant.MutantStatus
  readonly journey: string
  readonly misclassification: string
  readonly exitCode: number
  readonly journeyFailed: boolean
  readonly result: SeedResult
  readonly durationMs: number
  readonly traceIds: ReadonlyArray<string>
}

interface CommandOutcome {
  readonly exitCode: number
  readonly output: string
  readonly durationMs: number
  readonly timedOut: boolean
  readonly failure: string | null
}

const usage = (): string =>
  [
    'usage: node test/e2e/scripts/seed-status-fault.ts <status> [--dry-run]',
    '       node test/e2e/scripts/seed-status-fault.ts --all [--dry-run]',
    '',
    `statuses: ${STATUS_ORDER.join(', ')}`,
  ].join('\n')

const runCommand = (
  argv: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number,
): CommandOutcome => {
  const started = Date.now()
  const outcome = spawnSync(argv[0] ?? '', argv.slice(1), {
    cwd,
    encoding: 'utf8',
    maxBuffer: DECODE_MAX_BUFFER,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  })
  const stdout = outcome.stdout ?? ''
  const stderr = outcome.stderr ?? ''
  return {
    exitCode: outcome.status ?? (outcome.error === undefined ? 0 : 1),
    output: `${stdout}${stderr === '' ? '' : `\n${stderr}`}`,
    durationMs: Date.now() - started,
    timedOut: outcome.error !== undefined &&
      (outcome.error as NodeJS.ErrnoException & { code?: string }).code === 'ETIMEDOUT',
    failure: outcome.error === undefined ? null : String(outcome.error.message),
  }
}

const git = (argv: ReadonlyArray<string>, cwd: string): CommandOutcome => runCommand(['git', ...argv], cwd, 300_000)

const gitOrDie = (argv: ReadonlyArray<string>, cwd: string, step: string): string => {
  const outcome = git(argv, cwd)
  if (outcome.exitCode !== 0) {
    throw new Error(`${step}: git ${argv.join(' ')} exited ${outcome.exitCode}\n${outcome.output}`)
  }
  return outcome.output
}

const repoRootOf = (): string => {
  const outcome = git(['rev-parse', '--show-toplevel'], process.cwd())
  if (outcome.exitCode !== 0) {
    throw new Error(`not inside a git worktree: git rev-parse --show-toplevel exited ${outcome.exitCode}`)
  }
  return outcome.output.trim()
}

const porcelainOf = (repositoryRoot: string): ReadonlyArray<string> =>
  gitOrDie(['status', '--porcelain'], repositoryRoot, 'reading porcelain').split('\n').filter((line) => line !== '')

const porcelainPaths = (line: string): ReadonlyArray<string> =>
  line.slice(3).split(' -> ').map((path) => path.trim().replace(/^"|"$/gu, ''))

const ownedBySiblings = (path: string): boolean => SIBLING_OWNED_PATHS.some((pattern) => pattern.test(path))

const applyFault = (scratch: string, fault: Fault, status: Mutant.MutantStatus): string => {
  const target = join(scratch, fault.file)
  const text = readFileSync(target, 'utf8')
  const first = text.indexOf(fault.anchor)
  if (first < 0) {
    throw new Error(`${status}: the anchor is absent from ${fault.file}: ${JSON.stringify(fault.anchor)}`)
  }
  if (text.indexOf(fault.anchor, first + 1) >= 0) {
    throw new Error(`${status}: the anchor is not unique in ${fault.file}: ${JSON.stringify(fault.anchor)}`)
  }
  writeFileSync(target, `${text.slice(0, first)}${fault.replacement}${text.slice(first + fault.anchor.length)}`)
  return gitOrDie(['diff'], scratch, `${status}: reading the seeded diff`)
}

const traceIdsIn = (output: string): ReadonlyArray<string> => {
  const ids = new Set<string>()
  for (const match of output.matchAll(/trace ([0-9a-f]{32})/gu)) {
    if (match[1] !== undefined) ids.add(match[1])
  }
  for (const match of output.matchAll(/TRACEPARENT[="':\s]+00-([0-9a-f]{32})/gu)) {
    if (match[1] !== undefined) ids.add(match[1])
  }
  return [...ids].sort()
}

const artifactTraceIds = (scratch: string): ReadonlyArray<string> => {
  let names: Array<string>
  try {
    names = readdirSync(join(scratch, ARTIFACT_TRACES_DIRECTORY))
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const match = /^([0-9a-f]{32})\.json$/u.exec(name)
    return match === null || match[1] === undefined ? [] : [match[1]]
  })
}

const classify = (
  outcome: CommandOutcome,
  detection: RegExp,
): { readonly result: SeedResult; readonly journeyFailed: boolean } => {
  if (outcome.timedOut || LANE_TIMEOUT_EXIT_CODES.includes(outcome.exitCode)) {
    return { result: 'error', journeyFailed: false }
  }
  if (outcome.exitCode === 0) {
    return { result: 'not-red', journeyFailed: false }
  }
  if (TEST_FILES_FAILED.test(outcome.output) && TESTS_FAILED.test(outcome.output)) {
    return { result: detection.test(outcome.output) ? 'red' : 'wrong-reason', journeyFailed: true }
  }
  return { result: 'error', journeyFailed: false }
}

const registryWitnessFor = (status: Mutant.MutantStatus): string | undefined =>
  witnessRegistry.witnesses.find((witness) => witness.status === status)?.journey

const waiverReasonFor = (status: Mutant.MutantStatus): string | undefined =>
  witnessRegistry.waivers.find((waiver) => waiver.status === status)?.reason

const journeyArgumentOf = (journey: string): string => {
  if (!journey.startsWith(JOURNEY_PREFIX)) {
    throw new Error(`the registry journey ${journey} is outside ${JOURNEY_PREFIX}`)
  }
  const argument = journey.slice(JOURNEY_PREFIX.length)
  if (!argument.startsWith(JOURNEY_ARGUMENT_PREFIX)) {
    throw new Error(`the registry journey ${journey} is not a ${JOURNEY_ARGUMENT_PREFIX}... path`)
  }
  return argument
}

const reportsDirectoryOf = (repositoryRoot: string): string => resolve(repositoryRoot, REPORTS_DIRECTORY)

const writeResult = (
  repositoryRoot: string,
  result: StatusResult,
  log: string,
): void => {
  const directory = reportsDirectoryOf(repositoryRoot)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${result.status}.json`), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(join(directory, `${result.status}.log`), log)
}

const verdictLine = (result: StatusResult): string =>
  `${result.status}: ${result.result} (exit ${result.exitCode}, ${
    (result.durationMs / 1000).toFixed(1)
  }s) ${result.journey}${result.traceIds.length === 0 ? '' : ` [trace ${result.traceIds.join(', ')}]`}`

interface SeedOptions {
  readonly dryRun: boolean
}

const runStatus = (
  repositoryRoot: string,
  scratchParent: string,
  status: Mutant.MutantStatus,
  options: SeedOptions,
): StatusResult | null => {
  const fault = FAULTS[status]
  const waiver = waiverReasonFor(status)
  if (waiver !== undefined) {
    if (options.dryRun) {
      process.stdout.write(`\n=== ${status}: waived by the witness registry (${waiver}) ===\n`)
      return null
    }
    const waived: StatusResult = {
      status,
      journey: registryWitnessFor(status) ?? '',
      misclassification: fault.name,
      exitCode: 0,
      journeyFailed: false,
      result: 'waived',
      durationMs: 0,
      traceIds: [],
    }
    writeResult(repositoryRoot, waived, `waived by the witness registry: ${waiver}\n`)
    return waived
  }

  const journey = registryWitnessFor(status)
  if (journey === undefined) {
    throw new Error(`${status}: the witness registry names neither a witness nor a waiver`)
  }
  const journeyArgument = journeyArgumentOf(journey)
  const scratch = mkdtempSync(join(scratchParent, `${SCRATCH_PREFIX}${status}-`))
  const started = Date.now()
  const log: Array<string> = [`status: ${status}`, `fault: ${fault.name}`, `journey: ${journey}`]
  try {
    log.push(
      gitOrDie(['worktree', 'add', '--detach', scratch, 'HEAD'], repositoryRoot, 'creating the scratch worktree'),
    )
    const diff = applyFault(scratch, fault, status)
    log.push(diff)
    if (options.dryRun) {
      process.stdout.write(`\n=== ${status}: ${fault.name} (${fault.file}) ===\n${diff}`)
      return null
    }

    const install = runCommand(['pnpm', 'install', '--frozen-lockfile', '--offline'], scratch, INSTALL_TIMEOUT_MS)
    log.push(`\n$ pnpm install --frozen-lockfile --offline (exit ${install.exitCode})\n${install.output}`)
    if (install.exitCode !== 0) {
      const result: StatusResult = {
        status,
        journey,
        misclassification: fault.name,
        exitCode: install.exitCode,
        journeyFailed: false,
        result: 'error',
        durationMs: Date.now() - started,
        traceIds: [],
      }
      writeResult(repositoryRoot, result, log.join('\n'))
      return result
    }

    const lane = runCommand(
      [
        'flock',
        LANE_LOCK,
        'timeout',
        '--signal=TERM',
        `--kill-after=${LANE_KILL_AFTER}`,
        LANE_TIMEOUT_ARGUMENT,
        'pnpm',
        'test:e2e',
        '--',
        journeyArgument,
      ],
      scratch,
      (LANE_TIMEOUT_SECONDS + 120) * 1000 + COMMAND_SLACK_MS,
    )
    log.push(
      `\n$ flock ${LANE_LOCK} timeout ... pnpm test:e2e -- ${journeyArgument} (exit ${lane.exitCode})\n${lane.output}`,
    )
    const classified = classify(lane, fault.detection)
    const result: StatusResult = {
      status,
      journey,
      misclassification: fault.name,
      exitCode: lane.exitCode,
      journeyFailed: classified.journeyFailed,
      result: classified.result,
      durationMs: lane.durationMs,
      traceIds: [...new Set([...traceIdsIn(lane.output), ...artifactTraceIds(scratch)])].sort(),
    }
    writeResult(repositoryRoot, result, log.join('\n'))
    process.stdout.write(`${verdictLine(result)}\n`)
    return result
  } finally {
    git(['worktree', 'remove', '--force', scratch], repositoryRoot)
    rmSync(scratch, { recursive: true, force: true })
  }
}

const parseArgs = (
  argv: ReadonlyArray<string>,
): { readonly statuses: ReadonlyArray<Mutant.MutantStatus>; readonly dryRun: boolean } => {
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((argument) => argument !== '--dry-run' && argument !== '--')
  const all = rest.includes('--all')
  const named = rest.filter((argument) => argument !== '--all')
  if (all && named.length > 0) throw new Error('--all takes no status')
  if (!all && named.length !== 1) throw new Error(usage())
  if (all) return { statuses: STATUS_ORDER, dryRun }
  const requested = named[0] ?? ''
  const match = STATUS_ORDER.find((status) => status.toLowerCase() === requested.toLowerCase())
  if (match === undefined) throw new Error(`unknown status ${JSON.stringify(requested)}\n\n${usage()}`)
  return { statuses: [match], dryRun }
}

interface PorcelainChange {
  readonly sign: string
  readonly line: string
}

const changedPorcelain = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): ReadonlyArray<PorcelainChange> => {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return [
    ...before.filter((line) => !afterSet.has(line)).map((line): PorcelainChange => ({ sign: '-', line })),
    ...after.filter((line) => !beforeSet.has(line)).map((line): PorcelainChange => ({ sign: '+', line })),
  ]
}

const main = async (): Promise<number> => {
  const { statuses, dryRun } = parseArgs(process.argv.slice(2))
  const repositoryRoot = repoRootOf()
  const before = porcelainOf(repositoryRoot)
  const scratchParent = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX))
  const results: Array<StatusResult> = []
  try {
    for (const status of statuses) {
      const result = runStatus(repositoryRoot, scratchParent, status, { dryRun })
      if (result !== null) results.push(result)
    }
  } finally {
    rmSync(scratchParent, { recursive: true, force: true })
  }
  if (dryRun) {
    return 0
  }

  const after = porcelainOf(repositoryRoot)
  const changed = changedPorcelain(before, after)
  const foreign = changed.filter((change) => porcelainPaths(change.line).some((path) => !ownedBySiblings(path)))
  if (foreign.length > 0) {
    process.stderr.write(
      `seed-status-fault: the live worktree changed outside the sibling-owned paths:\n${
        foreign.map((change) => `${change.sign} ${change.line}`).join('\n')
      }\n`,
    )
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  const undetected = results.filter((result) => result.result !== 'red' && result.result !== 'waived')
  if (undetected.length > 0) {
    process.stderr.write(
      `seed-status-fault: ${undetected.length} status(es) did not turn their journey red: ${
        undetected.map((result) => `${result.status}=${result.result}`).join(', ')
      }\n`,
    )
  }
  return undetected.length === 0 && foreign.length === 0 ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (cause: unknown) {
  process.stderr.write(`seed-status-fault: ${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 2
}
