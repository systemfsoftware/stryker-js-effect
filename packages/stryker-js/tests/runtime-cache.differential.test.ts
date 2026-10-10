import { Differential } from '@systemfsoftware/differential-spec'
import { Cli } from '@systemfsoftware/stryker-js'
import { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Semaphore from 'effect/Semaphore'
import * as fc from 'fast-check'

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)

interface GeneratedProject {
  readonly operator: '+' | '-'
  readonly left: number
  readonly right: number
  readonly limit: number
}

const generatedProjects: fc.Arbitrary<GeneratedProject> = fc.record({
  operator: fc.constantFrom('+', '-'),
  left: fc.integer({ min: -6, max: 6 }),
  right: fc.integer({ min: -6, max: 6 }),
  limit: fc.integer({ min: 1, max: 4 }),
})

const renderSubject = (project: GeneratedProject): string =>
  [
    `export const combine = (left: number, right: number): number => left ${project.operator} right`,
    '',
    'export const spin = (limit: number): string => {',
    '  let step = 0',
    '  while (step < limit) {',
    '    step = step + 1',
    '  }',
    '  return String(step)',
    '}',
    '',
  ].join('\n')

const renderSubjectTest = (project: GeneratedProject): string =>
  [
    "import { expect, test } from 'vitest'",
    '',
    "import { combine, spin } from './subject'",
    '',
    `test('combine', () => { expect(combine(${project.left}, ${project.right})).toBe(${
      project.operator === '+' ? project.left + project.right : project.left - project.right
    }) })`,
    '',
    `test('spin', () => { expect(spin(${project.limit})).toBe('${project.limit}') })`,
    '',
  ].join('\n')

interface ModuleCacheOutcomes {
  readonly statuses: Record<string, string>
  readonly fixedOverheadMedianMs: number
}

const mutantKeyOf = (root: string, path: Path.Path) =>
(result: {
  readonly fileName: string
  readonly location: { readonly start: { readonly line: number; readonly column: number } }
  readonly mutatorName: string
  readonly replacement: string | null | undefined
}): string =>
  [
    path.relative(root, result.fileName),
    `${result.location.start.line}:${result.location.start.column}`,
    result.mutatorName,
    result.replacement ?? '',
  ].join('|')

const runEngine = (root: string, fsModuleCache: boolean): Effect.Effect<ModuleCacheOutcomes, never> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(root)
      return previous
    }),
    () =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const done = yield* Cli.strykerCell({
          testRunner: {
            plugin: WorkerHost.vmRunnerPluginUrl(),
            options: { pool: 'threads', fsModuleCache },
          },
          mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
          coverageAnalysis: 'perTest',
          mutator: { mutantSetPolicy: 'full' },
          concurrency: 1,
          ignorePatterns: ['**/node_modules/**'],
          reporters: ['json'],
          jsonReporter: { fileName: 'reports/mutation/mutation.json' },
        })
        const keyFor = mutantKeyOf(root, path)
        const records = done.results.map((result) => ({
          key: keyFor(result),
          status: result.status,
          fixedOverheadMs: result.cost?.fixedOverheadMs,
        }))
        const statuses = Object.fromEntries(
          [...records].sort((left, right) => (left.key < right.key ? -1 : 1)).map((record) => [
            record.key,
            record.status,
          ]),
        )
        const overheads = records.flatMap((record) =>
          record.fixedOverheadMs === undefined ? [] : [record.fixedOverheadMs]
        ).sort((left, right) => left - right)
        const middle = Math.floor(overheads.length / 2)
        const fixedOverheadMedianMs = overheads.length === 0
          ? 0
          : overheads.length % 2 === 1
          ? overheads[middle] ?? 0
          : ((overheads[middle - 1] ?? 0) + (overheads[middle] ?? 0)) / 2
        yield* Effect.annotateCurrentSpan({
          'runtime_cache.fs_module_cache': String(fsModuleCache),
          'runtime_cache.mutant_count': records.length,
          'runtime_cache.fixed_overhead_median_ms': fixedOverheadMedianMs,
        })
        return { statuses, fixedOverheadMedianMs } satisfies ModuleCacheOutcomes
      }),
    (previous) =>
      Effect.sync(() => {
        globalThis.process.chdir(previous)
      }),
  ).pipe(Effect.provide(Cli.platformLayer), Effect.orDie)

const exclusiveRuns = Semaphore.makeUnsafe(1)

const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Semaphore.withPermits(exclusiveRuns, 1)(effect)

const withGeneratedProject = <A, E, R>(
  project: GeneratedProject,
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectory({ prefix: 'runtime-cache-' })
      yield* fs.writeFileString(
        path.join(root, 'package.json'),
        '{\n  "name": "runtime-cache-fixture",\n  "private": true,\n  "type": "module"\n}\n',
      )
      yield* fs.writeFileString(
        path.join(root, 'vitest.config.js'),
        "export default { test: { environment: 'node', include: ['src/**/*.test.ts'] } }\n",
      )
      yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
      yield* fs.writeFileString(path.join(root, 'src', 'subject.ts'), renderSubject(project))
      yield* fs.writeFileString(path.join(root, 'src', 'subject.test.ts'), renderSubjectTest(project))
      yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
      return root
    }).pipe(Effect.orDie),
    use,
    (root) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })).pipe(
        Effect.orDie,
      ),
  )

const side = (fsModuleCache: boolean) => (project: GeneratedProject): Effect.Effect<ModuleCacheOutcomes> =>
  serialized(
    withGeneratedProject(project, (root) => runEngine(root, fsModuleCache)),
  ).pipe(Effect.provide(Cli.platformLayer), Effect.orDie)

const sameStatuses = (
  reference: Record<string, string>,
  candidate: Record<string, string>,
): boolean => {
  if (Object.keys(reference).length === 0) {
    return false
  }
  if (Object.keys(reference).length !== Object.keys(candidate).length) {
    return false
  }
  return Object.keys(reference).every((key) => reference[key] === candidate[key])
}

const HOST_BOUND = {
  timeout: 300_000,
  reason: 'each side boots Stryker test-runner worker processes and writes a sandbox on the host filesystem',
} as const

Differential.compare({
  name: 'runtime cache: fsModuleCache on and off agree on every mutant status',
  reference: side(false),
  candidate: side(true),
})
  .on(generatedProjects, { runBudget: 2, hostBound: HOST_BOUND })
  .assert((reference, candidate) => sameStatuses(reference.statuses, candidate.statuses))
