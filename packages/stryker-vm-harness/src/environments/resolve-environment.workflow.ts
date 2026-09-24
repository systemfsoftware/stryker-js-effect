import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const BUILTIN_ENVIRONMENT_DEPENDENCIES: Readonly<Record<string, string | undefined>> = {
  jsdom: 'jsdom',
  'happy-dom': 'happy-dom',
  'edge-runtime': '@edge-runtime/vm',
}

const isBuiltinEnvironmentName = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(BUILTIN_ENVIRONMENT_DEPENDENCIES, name)

const EnvironmentSpecTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-vm-harness/EnvironmentSpec',
)
type EnvironmentSpecTypeId = typeof EnvironmentSpecTypeId

export class ResolveEnvironmentCommand extends S.TaggedClass<ResolveEnvironmentCommand>()('ResolveEnvironmentCommand', {
  name: S.String,
  root: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class NodeEnvironment extends S.TaggedClass<NodeEnvironment>()('NodeEnvironment', {}) {
  readonly [EnvironmentSpecTypeId] = EnvironmentSpecTypeId
}

export class BuiltinEnvironment extends S.TaggedClass<BuiltinEnvironment>()('BuiltinEnvironment', {
  name: S.String,
  dependency: S.String,
}) {
  readonly [EnvironmentSpecTypeId] = EnvironmentSpecTypeId
}

export class FileEnvironment extends S.TaggedClass<FileEnvironment>()('FileEnvironment', {
  name: S.String,
  path: S.String,
}) {
  readonly [EnvironmentSpecTypeId] = EnvironmentSpecTypeId
}

export class PackageEnvironment extends S.TaggedClass<PackageEnvironment>()('PackageEnvironment', {
  name: S.String,
  dependency: S.String,
}) {
  readonly [EnvironmentSpecTypeId] = EnvironmentSpecTypeId
}

export type EnvironmentSpec = NodeEnvironment | BuiltinEnvironment | FileEnvironment | PackageEnvironment

export const EnvironmentSpecSchema = S.Union([
  NodeEnvironment,
  BuiltinEnvironment,
  FileEnvironment,
  PackageEnvironment,
])

const isAbsoluteLike = (name: string): boolean => name.startsWith('/') || /^[A-Za-z]:[/\\]/.test(name)

const joinModulePath = (root: string, name: string): string => (isAbsoluteLike(name) ? name : `${root}/${name}`)

const pathOrPackageSpec = (name: string, root: string): EnvironmentSpec =>
  Match.value(isAbsoluteLike(name) || name.startsWith('.')).pipe(
    Match.when(true, () => FileEnvironment.make({ name, path: joinModulePath(root, name) })),
    Match.when(
      false,
      () => PackageEnvironment.make({ name, dependency: `vitest-environment-${name}` }),
    ),
    Match.exhaustive,
  )

const builtinOrOtherSpec = (name: string, root: string): EnvironmentSpec => {
  const dependency = isBuiltinEnvironmentName(name) ? BUILTIN_ENVIRONMENT_DEPENDENCIES[name] : undefined
  return Match.value(dependency === undefined).pipe(
    Match.when(true, () => pathOrPackageSpec(name, root)),
    Match.when(false, () => BuiltinEnvironment.make({ name, dependency: dependency ?? '' })),
    Match.exhaustive,
  )
}

const specOf = (name: string, root: string): EnvironmentSpec =>
  Match.value(name === 'node').pipe(
    Match.when(true, () => NodeEnvironment.make({})),
    Match.when(false, () => builtinOrOtherSpec(name, root)),
    Match.exhaustive,
  )

const decide = (command: ResolveEnvironmentCommand): Result.Result<EnvironmentSpec, never> =>
  Result.succeed(specOf(command.name, command.root))

export const resolveEnvironment = Workflow.make({
  command: ResolveEnvironmentCommand,
  decision: EnvironmentSpecSchema,
  error: S.Never,
  decide,
})
