import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'

import { classifySandboxDirectory, SandboxDirectoryCommand } from './classify-sandbox-directory.workflow.js'
import { planNodeModulesLinks } from './plan-node-modules-links.workflow.js'
import { StrykerError } from './stryker-error.schema.js'

export interface LinkNodeModulesInput {
  readonly basePath: string
  readonly workingDirectory: string
  readonly tempDirName: string | undefined
}

type BaseWalk = {
  readonly basePath: string
  readonly tempDirName: string | undefined
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
}

type WalkStep = {
  readonly emit: readonly string[]
  readonly children: readonly string[]
}

const childDirectoriesOf = (dir: string, walk: BaseWalk): Effect.Effect<readonly string[], PlatformError> =>
  Effect.flatMap(
    walk.fs.readDirectory(walk.path.join(walk.basePath, dir)).pipe(Effect.orElseSucceed(() => [])),
    (entries) =>
      Effect.map(
        Effect.forEach(
          entries,
          (entry) => {
            const child = walk.path.join(dir, entry)
            return Effect.map(
              walk.fs.stat(walk.path.join(walk.basePath, child)).pipe(
                Effect.map((info) => info.type),
                Effect.orElseSucceed((): string => 'Unknown'),
              ),
              (statType) =>
                Boolean.match(statType === 'Directory', {
                  onTrue: () => Option.some(child),
                  onFalse: () => Option.none<string>(),
                }),
            )
          },
          { concurrency: 1 },
        ),
        (children) => children.filter(Option.isSome).map((some) => some.value),
      ),
  )

const roleOf = (dir: string, walk: BaseWalk) =>
  Result.getOrElse(
    classifySandboxDirectory(
      SandboxDirectoryCommand.make({ name: walk.path.basename(dir), tempDirName: walk.tempDirName }),
    ),
    (unreachable: never) => unreachable,
  )

const walkStep = (dir: string, walk: BaseWalk): Effect.Effect<WalkStep, PlatformError> =>
  Match.value(roleOf(dir, walk)).pipe(
    Match.tagsExhaustive({
      NodeModulesDirectory: () => Effect.succeed({ emit: [dir], children: [] }),
      DirectorySkipped: () => Effect.succeed({ emit: [], children: [] }),
      SearchableDirectory: () => Effect.map(childDirectoriesOf(dir, walk), (children) => ({ emit: [], children })),
    }),
  )

const nodeModulesStream = (walk: BaseWalk): Stream.Stream<string, PlatformError> =>
  Stream.paginate<string[], string, PlatformError, never>(
    ['.'],
    (queue) =>
      Option.match(Option.fromUndefinedOr(queue[queue.length - 1]), {
        onNone: () => Effect.succeed<readonly [ReadonlyArray<string>, Option.Option<string[]>]>([[], Option.none()]),
        onSome: (dir) =>
          Effect.map(walkStep(dir, walk), ({ emit, children }) =>
            [
              emit,
              Option.some([...queue.slice(0, -1), ...children]),
            ] as const),
      }),
  )

const findNodeModulesList = Effect.fn(SpanTaxonomy.Spans.sandboxFindNodeModules.name)(function*(
  basePath: string,
  tempDirName: string | undefined,
): Effect.fn.Return<string[], PlatformError, FileSystem.FileSystem | Path.Path> {
  const walk: BaseWalk = {
    basePath,
    tempDirName,
    fs: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
  }
  const found = yield* Stream.runCollect(nodeModulesStream(walk))
  return [...found]
})

const symlinkJunction = Effect.fn(SpanTaxonomy.Spans.sandboxSymlinkJunction.name)(function*(
  to: string,
  from: string,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fsService = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  yield* fsService.makeDirectory(pathService.dirname(from), { recursive: true })
  yield* fsService.symlink(to, from)
})

const linkNodeModules = Effect.fn(SpanTaxonomy.Spans.sandboxLinkNodeModules.name)(function*(
  nodeModules: string,
  input: LinkNodeModulesInput,
): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  const pathService = yield* Path.Path
  const resolvedTo = pathService.resolve(pathService.join(input.basePath, nodeModules))
  const resolvedFrom = pathService.join(input.workingDirectory, nodeModules)
  yield* Effect.logDebug(`Create symlink from ${resolvedTo} to ${resolvedFrom}`)
  yield* symlinkJunction(resolvedTo, resolvedFrom).pipe(
    Effect.tapError(() =>
      Effect.logWarning(
        `Unexpected error while trying to symlink "${nodeModules}" in sandbox directory.`,
      )
    ),
    Effect.catchTag('PlatformError', () => Effect.void),
  )
})

const readNodeModules = Effect.fnUntraced(function*(input: LinkNodeModulesInput) {
  yield* Effect.logDebug('Start symlink node_modules')
  const found = yield* findNodeModulesList(input.basePath, input.tempDirName)
  return { _tag: 'NodeModulesSearchCommand' as const, found, input }
})

export const linkNodeModulesCell: Cell.Cell<
  LinkNodeModulesInput,
  void,
  PlatformError | StrykerError,
  FileSystem.FileSystem | Path.Path
> = Sandwich.named(SpanTaxonomy.Spans.sandboxSymlinkNodeModules.name)(readNodeModules)
  .decide(planNodeModulesLinks)
  .write({
    NodeModulesNotFound: (_decision, raw) =>
      Effect.logDebug(
        `Could not find a node_modules folder to symlink into the sandbox directory. Search "${raw.input.basePath}" and its parent directories`,
      ),
    NodeModulesLinked: ({ nodeModules }, raw) =>
      Effect.forEach(nodeModules, (found) => linkNodeModules(found, raw.input), { concurrency: 1, discard: true }),
    CommandRejected: ({ issue }) =>
      Effect.fail(StrykerError.make({ message: `Could not decide which node_modules to link: ${issue}` })),
  })
