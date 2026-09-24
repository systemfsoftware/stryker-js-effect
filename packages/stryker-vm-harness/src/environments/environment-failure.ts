import * as Match from 'effect/Match'

import type { EnvironmentSpec } from './resolve-environment.workflow.js'

export const environmentDependency = (spec: EnvironmentSpec): string | undefined =>
  Match.value(spec).pipe(
    Match.tag('BuiltinEnvironment', (builtin) => builtin.dependency),
    Match.tag('PackageEnvironment', (custom) => custom.dependency),
    Match.tag('NodeEnvironment', () => undefined),
    Match.tag('FileEnvironment', () => undefined),
    Match.exhaustive,
  )

export const missingEnvironmentDependencyMessage = (dependency: string): string =>
  `MISSING DEPENDENCY Cannot find dependency '${dependency}'. Install it with \`npm i -D ${dependency}\`.`

const MISSING_MODULE_CODES: ReadonlySet<string> = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

export interface MissingEnvironmentModule {
  readonly dependency: string
}

const ownStringProperty = (source: object, name: string): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(source, name)
  return typeof descriptor?.value === 'string' ? descriptor.value : undefined
}

export const isMissingEnvironmentModule = (caught: unknown, dependency: string): caught is MissingEnvironmentModule => {
  if (typeof caught !== 'object' || caught === null) return false
  const code = ownStringProperty(caught, 'code')
  const message = ownStringProperty(caught, 'message') ?? ''
  return MISSING_MODULE_CODES.has(code ?? '') && message.includes(dependency)
}
