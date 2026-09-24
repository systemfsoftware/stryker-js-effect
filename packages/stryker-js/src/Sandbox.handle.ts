import { Boolean, Predicate } from 'effect'
import * as Match from 'effect/Match'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'

import { StrykerError } from './stryker-error.schema.js'

export interface SandboxHandle {
  readonly workingDirectory: string
  readonly sandboxFileFor: (fileName: string) => Result.Result<string, StrykerError>
  readonly originalFileFor: (sandboxFileName: string) => string
}

export const TypeId = Symbol.for('@systemfsoftware/stryker-js/SandboxHandle')
export type TypeId = typeof TypeId

export const isSandboxHandle = (u: unknown): u is SandboxHandle => Predicate.hasProperty(u, TypeId)

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
}): SandboxHandle => {
  const handle: SandboxHandle = {
    workingDirectory: options.workingDirectory,
    sandboxFileFor: (fileName) => sandboxFileNameOf(options.fileMap, fileName),
    originalFileFor: (sandboxFileName) =>
      originalFileNameOf(sandboxFileName, options.workingDirectory, options.basePath, options.pathService),
  }
  return Object.assign(handle, { [TypeId]: TypeId })
}
