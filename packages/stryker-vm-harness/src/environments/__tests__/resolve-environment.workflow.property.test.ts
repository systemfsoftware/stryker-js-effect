import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { ResolveEnvironmentFixtureSchema } from '../../../tests/__fixtures__/environments.schema.js'
import { type EnvironmentSpec, resolveEnvironment, ResolveEnvironmentCommand } from '../resolve-environment.workflow.js'

const BUILTIN_DEPENDENCIES: Readonly<Record<string, string>> = {
  jsdom: 'jsdom',
  'happy-dom': 'happy-dom',
  'edge-runtime': '@edge-runtime/vm',
}

const isAbsoluteLike = (name: string): boolean => name.startsWith('/') || /^[A-Za-z]:[/\\]/.test(name)

const joinModulePath = (root: string, name: string): string => (isAbsoluteLike(name) ? name : `${root}/${name}`)

const isBuiltinName = (name: string): boolean => Object.prototype.hasOwnProperty.call(BUILTIN_DEPENDENCIES, name)

const oracleOf = (name: string, root: string): string =>
  Match.value(name === 'node').pipe(
    Match.when(true, () => 'node'),
    Match.when(false, () =>
      Match.value(isBuiltinName(name)).pipe(
        Match.when(true, () => `builtin:${BUILTIN_DEPENDENCIES[name]}`),
        Match.when(false, () =>
          Match.value(isAbsoluteLike(name) || name.startsWith('.')).pipe(
            Match.when(true, () => `file:${joinModulePath(root, name)}`),
            Match.when(false, () => `package:vitest-environment-${name}`),
            Match.exhaustive,
          )),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const actualOf = (spec: EnvironmentSpec): string =>
  Match.value(spec).pipe(
    Match.tag('NodeEnvironment', () => 'node'),
    Match.tag('BuiltinEnvironment', (builtin) => `builtin:${builtin.dependency}`),
    Match.tag('FileEnvironment', (file) => `file:${file.path}`),
    Match.tag('PackageEnvironment', (custom) => `package:${custom.dependency}`),
    Match.exhaustive,
  )

describe('resolveEnvironment', () => {
  it.prop(
    '∀name_EnvironmentSpec_≡VitestOracle',
    { of: [ResolveEnvironmentFixtureSchema], subject: resolveEnvironment },
    (resolve, [{ name, root }]) => {
      const decision = Result.getOrThrow(resolve(ResolveEnvironmentCommand.make({ name, root })))
      return actualOf(decision) === oracleOf(name, root)
    },
  )

  it.prop(
    '∀name_EnvironmentSpec_→Dependency',
    { of: [ResolveEnvironmentFixtureSchema], subject: resolveEnvironment },
    (resolve, [{ name }]) => {
      const decision = Result.getOrThrow(resolve(ResolveEnvironmentCommand.make({ name, root: '/sandbox' })))
      return Match.value(decision).pipe(
        Match.tag('NodeEnvironment', () => true),
        Match.tag('FileEnvironment', () => true),
        Match.tag('BuiltinEnvironment', (builtin) => BUILTIN_DEPENDENCIES[builtin.name] === builtin.dependency),
        Match.tag('PackageEnvironment', (custom) => custom.dependency === `vitest-environment-${custom.name}`),
        Match.exhaustive,
      )
    },
  )
})
