import { Handle } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import type * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'

import { StrykerError } from './stryker-error.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/Sandbox')
export type TypeId = typeof TypeId

const SandboxHandle = Handle.make<
  { readonly workingDirectory: string },
  {
    readonly fileMap: Map<string, string>
    readonly basePath: string
    readonly pathService: Path.Path
  }
>()(TypeId)

export type SandboxHandle = Handle.Of<typeof SandboxHandle>

export const isSandboxHandle = SandboxHandle.is

const sandboxFileNameOf = (fileMap: Map<string, string>, fileName: string) =>
  Match.value(fileMap.get(fileName)).pipe(
    Match.when(Predicate.isString, (sandboxFileName) => Result.succeed(sandboxFileName)),
    Match.orElse(() => Result.fail(StrykerError.make({ message: `Cannot find sandbox file for ${fileName}` }))),
  )

const withoutLeadingSeparator = (suffix: string) =>
  Boolean.match(suffix.startsWith('/'), {
    onTrue: () => suffix.slice(1),
    onFalse: () => suffix,
  })

const relativeToBase = (resolvedSandbox: string, resolvedWorking: string, base: string, pathService: Path.Path) => {
  const trimmed = withoutLeadingSeparator(resolvedSandbox.slice(resolvedWorking.length))
  return Boolean.match(trimmed.length === 0, {
    onTrue: () => base,
    onFalse: () => pathService.join(base, trimmed),
  })
}

const originalFileNameOf = (
  sandboxFileName: string,
  workingDirectory: string,
  base: string,
  pathService: Path.Path,
) => {
  const resolvedSandbox = pathService.resolve(sandboxFileName)
  const resolvedWorking = pathService.resolve(workingDirectory)
  return Boolean.match(resolvedSandbox.startsWith(resolvedWorking), {
    onTrue: () => relativeToBase(resolvedSandbox, resolvedWorking, base, pathService),
    onFalse: () => resolvedSandbox.replace(resolvedWorking, base),
  })
}

export const make = (options: {
  readonly fileMap: Map<string, string>
  readonly workingDirectory: string
  readonly basePath: string
  readonly pathService: Path.Path
}): SandboxHandle =>
  SandboxHandle.make(
    { workingDirectory: options.workingDirectory },
    { fileMap: options.fileMap, basePath: options.basePath, pathService: options.pathService },
  )

export const sandboxFileFor: {
  (fileName: string): (self: SandboxHandle) => Result.Result<string, StrykerError>
  (self: SandboxHandle, fileName: string): Result.Result<string, StrykerError>
} = dual(
  2,
  (self: SandboxHandle, fileName: string): Result.Result<string, StrykerError> =>
    sandboxFileNameOf(SandboxHandle.slot(self).fileMap, fileName),
)

export const originalFileFor: {
  (sandboxFileName: string): (self: SandboxHandle) => string
  (self: SandboxHandle, sandboxFileName: string): string
} = dual(2, (self: SandboxHandle, sandboxFileName: string): string => {
  const slot = SandboxHandle.slot(self)
  return originalFileNameOf(sandboxFileName, self.workingDirectory, slot.basePath, slot.pathService)
})
