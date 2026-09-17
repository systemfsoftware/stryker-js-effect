import type { LogLevel, PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Flag from 'effect/unstable/cli/Flag'

const createSplitter = (separator: string) => (value: string) => value.split(separator).filter(Boolean)

export const splitOnComma = createSplitter(',')
export const splitOnSpace = createSplitter(' ')

const CLEAN_TEMP_DIR_DISABLED = ['false', '0'] as const

export function parseCleanDirOption(value: string): 'always' | boolean {
  const normalized = value.toLocaleLowerCase()
  return Match.value(normalized).pipe(
    Match.when('always', () => 'always' as const),
    Match.orElse(() => !CLEAN_TEMP_DIR_DISABLED.some((disabled) => disabled === normalized)),
  )
}

export function parseConcurrency(value: string): number | string {
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10)
  }
  return value
}

export const optional = <A>(option: Flag.Flag<A>) => Flag.optional(option)

export const absentWhenFalse = (value: Option.Option<boolean>): boolean | undefined =>
  Option.getOrUndefined(Option.filter(value, (present) => present))

export const isUnknownArgument = (argument: string | undefined): argument is string =>
  Option.exists(Option.fromUndefinedOr(argument), (text) => text.startsWith('-'))

export function unwrap<A>(value: Option.Option<A> | A | undefined): A | undefined {
  if (Option.isOption(value)) {
    return Option.getOrUndefined(value)
  }
  return value
}

export function setIfPresent<K extends keyof StrykerOptions>(
  target: PartialStrykerOptions,
  key: K,
  value: Option.Option<StrykerOptions[K]> | StrykerOptions[K] | undefined,
): void {
  const unwrapped = unwrap(value)
  if (unwrapped !== undefined) {
    target[key] = unwrapped
  }
}

export function setLogLevel(
  target: PartialStrykerOptions,
  key: 'logLevel' | 'fileLogLevel',
  value: Option.Option<LogLevel> | LogLevel | undefined,
): void {
  const unwrapped = unwrap(value)
  if (unwrapped !== undefined) {
    target[key] = unwrapped
  }
}
