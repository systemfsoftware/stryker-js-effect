import { dual } from 'effect/Function'
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

const MISSING_MODULE_CODES: Readonly<Record<string, true>> = {
  ERR_MODULE_NOT_FOUND: true,
  MODULE_NOT_FOUND: true,
}

export interface MissingEnvironmentModule {
  readonly dependency: string
}

const ownStringProperty = (source: object, name: string): string | undefined =>
  Match.value(Object.getOwnPropertyDescriptor(source, name)).pipe(
    Match.when(Match.undefined, (): string | undefined => undefined),
    Match.orElse((descriptor) => typeof descriptor.value === 'string' ? descriptor.value : undefined),
  )

const isObjectValue = (candidate: unknown): candidate is object => typeof candidate === 'object' && candidate !== null

const failureCodeMatches = (caught: object): boolean =>
  Object.hasOwn(MISSING_MODULE_CODES, ownStringProperty(caught, 'code') ?? '')

const failureMessageNames = (caught: object, dependency: string): boolean =>
  (ownStringProperty(caught, 'message') ?? '').includes(dependency)

const isMissingModuleFailure = (caught: object, dependency: string): boolean =>
  failureCodeMatches(caught) && failureMessageNames(caught, dependency)

export const isMissingEnvironmentModule = dual<
  (dependency: string) => (caught: unknown) => caught is MissingEnvironmentModule,
  (caught: unknown, dependency: string) => caught is MissingEnvironmentModule
>(
  2,
  (caught, dependency): caught is MissingEnvironmentModule =>
    isObjectValue(caught) && isMissingModuleFailure(caught, dependency),
)
