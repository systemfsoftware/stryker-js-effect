import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

const NodeResolutionSchema = S.Struct({ esm: S.NullOr(S.String), cjs: S.NullOr(S.String) })
export type NodeResolution = typeof NodeResolutionSchema.Type

const NodeResolutionsSchema = S.Struct({ imports: NodeResolutionSchema, exports: NodeResolutionSchema })
export type NodeResolutions = typeof NodeResolutionsSchema.Type

const PROBE = 'probe.mjs'

const PROBE_SOURCE = [
  "import { createRequire } from 'node:module'",
  "import { basename } from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
  'const require = createRequire(import.meta.url)',
  'const attempt = (resolve) => { try { return basename(resolve()) } catch { return null } }',
  'const of = (specifier) => ({',
  '  esm: attempt(() => fileURLToPath(import.meta.resolve(specifier))),',
  '  cjs: attempt(() => require.resolve(specifier)),',
  '})',
  "process.stdout.write(JSON.stringify({ imports: of('#x'), exports: of('@fx/lib/x') }))",
  '',
].join('\n')

export const probeFile: readonly [string, string] = [PROBE, PROBE_SOURCE]

const decodeResolutions = S.decodeUnknownEffect(S.fromJsonString(NodeResolutionsSchema))

export const resolveWithNode = (
  root: string,
): Effect.Effect<NodeResolutions, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [PROBE], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.runDrain))
      yield* handle.exitCode
      return yield* decodeResolutions(yield* Fiber.join(stdout))
    }),
  ).pipe(Effect.orDie)
