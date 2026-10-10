import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONSUMER_PACKAGE = '{ "name": "audit-consumer", "type": "module", "private": true }\n'
const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: ['clear-text'],
}
`
const SOURCE_FILE = 'src/sign.js'
const SOURCE = 'export const isPositive = (n) => n > 0\n'
const NAMED_TEST = 'test/sign.test.js#isPositive keeps zero out'
const OTHER_TEST = 'test/sign.test.js#isPositive admits one'
const MATRIX_DIR = 'matrix'
const AUDIT_OUT = 'reports/audit.json'

interface MatrixRecord {
  readonly id: string
  readonly status: string
  readonly killedBy: ReadonlyArray<string>
}

interface AuditRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const decodeDropAudit = S.decodeUnknownEffect(S.fromJsonString(S.Struct({
  pairs: S.Array(S.Struct({
    mutant: S.String,
    dominator: S.String,
    verdict: S.optional(S.Struct({ reason: S.String })),
    reason: S.optional(S.String),
  })),
})))

const decodeCounts = S.decodeUnknownEffect(S.fromJsonString(S.Struct({
  total: S.Struct({ planned: S.Int, compiled: S.Int, statuses: S.Struct({ CompileError: S.Int, Killed: S.Int }) }),
})))

const matrixJson = (root: string, mutants: ReadonlyArray<MatrixRecord>): string =>
  `${
    JSON.stringify({
      projectRoot: root,
      files: { [SOURCE_FILE]: { source: SOURCE, mutants } },
      testFiles: { 'test/sign.test.js': { tests: [{ id: NAMED_TEST }, { id: OTHER_TEST }] } },
    })
  }\n`

const prepareProject = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing - build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-audit-' }))
    yield* fs.makeDirectory(path.join(root, 'node_modules', '@systemfsoftware'), { recursive: true })
    yield* fs.symlink(PACKAGE_ROOT, path.join(root, 'node_modules', '@systemfsoftware', 'stryker-js'))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.makeDirectory(path.join(root, MATRIX_DIR))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* fs.writeFileString(path.join(root, SOURCE_FILE), SOURCE)
    return root
  }).pipe(Effect.orDie)

const writeMatrix = (
  root: string,
  mutants: ReadonlyArray<MatrixRecord>,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.writeFileString(path.join(root, MATRIX_DIR, 'stryker-incremental.json'), matrixJson(root, mutants))
  }).pipe(Effect.orDie)

const runAudit = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<AuditRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'audit', '--out', AUDIT_OUT, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'human', NO_COLOR: '1' },
          extendEnv: true,
        }),
      )
      const printedOut = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const printedErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      const [out, err] = yield* Effect.all([Fiber.join(printedOut), Fiber.join(printedErr)])
      return { exitCode: Number(exitCode), stdout: out, stderr: err }
    }),
  ).pipe(Effect.orDie)

const readAuditText = (root: string): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* fs.readFileString(path.join(root, AUDIT_OUT))
  }).pipe(Effect.orDie)

interface AuditedPairView {
  readonly mutant: string
  readonly dominator: string
  readonly verdict?: { readonly reason: string } | undefined
  readonly reason?: string | undefined
}

interface DropAuditView {
  readonly pairs: ReadonlyArray<AuditedPairView>
}

interface AuditedRun {
  readonly ran: AuditRun
  readonly audit: DropAuditView
}

interface DroppedPair {
  readonly mutant: string
  readonly dominator: string
}

type AuditServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

const readDropAudit = (root: string): Effect.Effect<DropAuditView, never, FileSystem.FileSystem | Path.Path> =>
  Effect.flatMap(readAuditText(root), decodeDropAudit).pipe(Effect.orDie)

const discoverDroppedPair = (root: string): Effect.Effect<DroppedPair, never, AuditServices> =>
  Effect.gen(function*() {
    yield* writeMatrix(root, [])
    yield* runAudit(root, ['--matrix', MATRIX_DIR])
    const audit = yield* readDropAudit(root)
    return yield* Option.match(Arr.head(audit.pairs), {
      onNone: () => Effect.die(new Error('the audit named no dropped mutant for the relational comparison')),
      onSome: ({ mutant, dominator }) => Effect.succeed({ mutant, dominator }),
    })
  })

const auditWith = (
  root: string,
  pair: DroppedPair,
  killers: { readonly mutant: ReadonlyArray<string>; readonly dominator: ReadonlyArray<string> },
): Effect.Effect<AuditedRun, never, AuditServices> =>
  Effect.gen(function*() {
    yield* writeMatrix(root, [
      { id: pair.mutant, status: 'Killed', killedBy: killers.mutant },
      { id: pair.dominator, status: 'Killed', killedBy: killers.dominator },
    ])
    const ran = yield* runAudit(root, ['--matrix', MATRIX_DIR])
    const audit = yield* readDropAudit(root)
    return { ran, audit }
  })

const reasonsOf = (audit: DropAuditView): ReadonlyArray<string> =>
  audit.pairs.map((pair) => pair.verdict?.reason ?? pair.reason ?? '')

Feature('Auditing the mutants the default policy drops against a kill matrix', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary instruments the matrix sources and joins every drop in a real Node process')
  .body(({ scenario }) => {
    scenario(
      'A drop whose dominator is killed by a named test that spares the dropped mutant fails the audit',
      Gherkin.Do.pipe(
        Given('a project whose one relational comparison drops its complement')('root', () => prepareProject()),
        Given('the drop and its dominator as the audit names them')('pair', (s) => discoverDroppedPair(s.root)),
        When('the matrix records a named test that kills only the dominator')(
          'audited',
          (s) => auditWith(s.root, s.pair, { mutant: [OTHER_TEST], dominator: [NAMED_TEST, OTHER_TEST] }),
        ),
        Then('the process exits 1 and the pair fails because the killers are not contained')((s, expect) =>
          expect({
            exitCode: s.audited.ran.exitCode,
            reasons: reasonsOf(s.audited.audit),
          }).toStrictEqual({ exitCode: 1, reasons: ['killers-not-contained'] })
        ),
      ),
    )

    scenario(
      'A drop killed by every test that kills its dominator passes the audit',
      Gherkin.Do.pipe(
        Given('a project whose one relational comparison drops its complement')('root', () => prepareProject()),
        Given('the drop and its dominator as the audit names them')('pair', (s) => discoverDroppedPair(s.root)),
        When('the matrix records the same named test killing both')(
          'audited',
          (s) => auditWith(s.root, s.pair, { mutant: [NAMED_TEST], dominator: [NAMED_TEST] }),
        ),
        Then('the process exits 0 and the pair passes on contained killers')((s, expect) =>
          expect({
            exitCode: s.audited.ran.exitCode,
            reasons: reasonsOf(s.audited.audit),
          }).toStrictEqual({ exitCode: 0, reasons: ['killers-contained'] })
        ),
      ),
    )

    scenario(
      'A matrix that records neither mutant leaves the rule unattested and fails the audit',
      Gherkin.Do.pipe(
        Given('a project whose one relational comparison drops its complement')('root', () => prepareProject()),
        Given('a matrix holding the source but no mutant')('matrix', (s) => writeMatrix(s.root, [])),
        When('stryker audits the drops')('ran', (s) => runAudit(s.root, ['--matrix', MATRIX_DIR])),
        When('the audit report is read back')('audit', (s) => readDropAudit(s.root)),
        Then('the process exits 1 because the matrix has no record of the dropped mutant')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, reasons: reasonsOf(s.audit) }).toStrictEqual({
            exitCode: 1,
            reasons: ['mutant-absent'],
          })
        ),
      ),
    )

    scenario(
      'Counting a finished run reads planned, CompileError and compiled from the reports alone',
      Gherkin.Do.pipe(
        Given('a project')('root', () => prepareProject()),
        Given('a report with one Killed, one CompileError and one Ignored mutant')(
          'matrix',
          (s) =>
            writeMatrix(s.root, [
              { id: '1a1a1a1a1a1a1a1a', status: 'Killed', killedBy: [NAMED_TEST] },
              { id: '2b2b2b2b2b2b2b2b', status: 'CompileError', killedBy: [] },
              { id: '3c3c3c3c3c3c3c3c', status: 'Ignored', killedBy: [] },
            ]),
        ),
        When('stryker audits with --counts-only')(
          'ran',
          (s) => runAudit(s.root, ['--counts-only', '--matrix', MATRIX_DIR]),
        ),
        When('the counts are read back')(
          'counts',
          (s) => Effect.flatMap(readAuditText(s.root), decodeCounts).pipe(Effect.orDie),
        ),
        Then('the process exits 0 and only the Killed mutant counts as compiled')((s, expect) =>
          expect({ exitCode: s.ran.exitCode, counts: s.counts }).toStrictEqual({
            exitCode: 0,
            counts: { total: { planned: 3, compiled: 1, statuses: { CompileError: 1, Killed: 1 } } },
          })
        ),
      ),
    )

    scenario(
      'A matrix directory without the project report is an input failure that names the fix',
      Gherkin.Do.pipe(
        Given('a project with an empty matrix directory')('root', () => prepareProject()),
        When('stryker audits against it')('ran', (s) => runAudit(s.root, ['--matrix', MATRIX_DIR])),
        Then('the process exits 2 and stderr names the unreadable matrix and where it should point')((s, expect) =>
          expect({
            exitCode: s.ran.exitCode,
            namesTheCode: s.ran.stderr.includes('matrix-unreadable'),
            namesTheFix: s.ran.stderr.includes('Pass --matrix the directory'),
          }).toStrictEqual({ exitCode: 2, namesTheCode: true, namesTheFix: true })
        ),
      ),
    )
  })
