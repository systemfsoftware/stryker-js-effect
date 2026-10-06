import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'

import { normalizeEmit } from './emit-text.js'

export interface TceEmitRequest {
  readonly tsconfigFile: string
  readonly sourceExtension: string
  readonly originalContent: string
  readonly mutants: ReadonlyArray<{ readonly key: string; readonly content: string }>
}

export interface TceEmitResult {
  readonly original: string
  readonly byKey: HashMap.HashMap<string, string>
}

const sourceFileName = (index: number, extension: string): string => `tce-input-${index}${extension}`

const EMITTED_EXTENSION: Record<string, string> = { '.mts': '.mjs', '.cts': '.cjs' }

const emittedExtensionOf = (extension: string): string => EMITTED_EXTENSION[extension] ?? '.js'

const compilerOptionsOf = (outDir: string, rootDir: string) => ({
  noEmit: false,
  noCheck: true,
  noEmitOnError: false,
  emitDeclarationOnly: false,
  declaration: false,
  declarationMap: false,
  sourceMap: false,
  composite: false,
  incremental: false,
  outDir,
  rootDir,
  skipLibCheck: true,
})

const cliPathOf = Effect.gen(function*() {
  const path = yield* Path.Path
  const packageFile = yield* path.fromFileUrl(new URL(import.meta.resolve('typescript/package.json')))
  return path.join(path.dirname(packageFile), 'bin', 'tsc')
})

const writeInputs = (
  request: TceEmitRequest,
  directory: string,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const originalName = sourceFileName(0, request.sourceExtension)
    yield* fs.writeFileString(path.join(directory, originalName), request.originalContent)
    const names = Arr.map(request.mutants, (_, index) => sourceFileName(index + 1, request.sourceExtension))
    yield* Effect.forEach(
      request.mutants,
      (mutant, index) =>
        fs.writeFileString(path.join(directory, sourceFileName(index + 1, request.sourceExtension)), mutant.content),
      { discard: true },
    )
    return [originalName, ...names]
  }).pipe(Effect.orDie)

const tsconfigTextOf = Effect.fnUntraced(function*(
  request: TceEmitRequest,
  directory: string,
  files: ReadonlyArray<string>,
) {
  const path = yield* Path.Path
  const outDir = path.join(directory, 'out')
  return yield* S.encodeEffect(S.fromJsonString(S.Unknown))({
    extends: request.tsconfigFile,
    compilerOptions: compilerOptionsOf(outDir, directory),
    references: [],
    files,
    include: [],
    exclude: [],
  })
})

const runEmit = (
  request: TceEmitRequest,
  directory: string,
): Effect.Effect<
  TceEmitResult,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cli = yield* cliPathOf
    const files = yield* writeInputs(request, directory)
    const outDir = path.join(directory, 'out')
    yield* fs.writeFileString(path.join(directory, 'tsconfig.json'), yield* tsconfigTextOf(request, directory, files))
    yield* Effect.scoped(
      ChildProcess.make(cli, ['-p', path.join(directory, 'tsconfig.json')], {
        cwd: directory,
        stdout: 'ignore',
        stderr: 'ignore',
      }).pipe(Effect.flatMap((handle) => handle.exitCode)),
    )
    const readEmitted = (index: number) =>
      Effect.map(
        fs.readFileString(path.join(outDir, `tce-input-${index}${emittedExtensionOf(request.sourceExtension)}`)),
        normalizeEmit,
      )
    const original = yield* readEmitted(0)
    const emits = yield* Effect.forEach(request.mutants, (_, index) => readEmitted(index + 1))
    return {
      original,
      byKey: HashMap.fromIterable(Arr.map(Arr.zip(request.mutants, emits), ([mutant, emit]) => [mutant.key, emit])),
    }
  }).pipe(Effect.orDie)

export const emitNormalized = (
  request: TceEmitRequest,
): Effect.Effect<
  Option.Option<TceEmitResult>,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.flatMap(
      fs.makeTempDirectory({ prefix: 'stryker-tce-' }),
      (directory) =>
        runEmit(request, directory).pipe(
          Effect.ensuring(fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore)),
          Effect.asSome,
        ),
    )).pipe(Effect.orElseSucceed(() => Option.none<TceEmitResult>()))
