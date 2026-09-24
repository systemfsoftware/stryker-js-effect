import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

export const ErrorText = S.Unknown.pipe(
  S.decodeTo(S.NonEmptyString, {
    decode: SGetter.transform(errorTextOf),
    encode: SGetter.forbiddenEncoding,
  }),
)
export type ErrorTextValue = typeof ErrorText.Type

export const CauseText = S.Unknown.pipe(
  S.decodeTo(S.NonEmptyString, {
    decode: SGetter.transform(causeChainTextOf),
    encode: SGetter.forbiddenEncoding,
  }),
)
export type CauseTextValue = typeof CauseText.Type

function errorTextOf<A = unknown>(error: A): string {
  return Match.value(error).pipe(
    Match.when(isEmptyError, () => ''),
    Match.when(Match.instanceOf(Error), errorText),
    Match.orElse(() => stringifyNonError(error)),
  )
}

export interface ErrnoException extends Error {
  code?: string
  errno?: number
  path?: string
  syscall?: string
}

function causeChainTextOf<A = unknown>(cause: A): string {
  return causeText(cause, 1) ?? ''
}

const hasText = (value: unknown): value is string => Predicate.isString(value) && value.length > 0

const textIfNonEmpty = <A = unknown>(value: A): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.fromUndefinedOr(value), hasText))

function readFieldOf<A = unknown>(record: Record<string, A>, key: string): A | undefined {
  return record[key]
}

const hasFieldIn = <A = unknown>(value: object, key: string): value is Record<string, A> => key in value

const fieldOf = <A = unknown>(value: object, key: string): A | undefined =>
  Option.getOrUndefined(
    Option.filter(Option.some(value), (candidate): candidate is Record<string, A> => hasFieldIn<A>(candidate, key)).pipe(
      Option.map((record) => readFieldOf(record, key)),
    ),
  )

const hasStringCode = (error: Error): boolean =>
  Match.value(fieldOf(error, 'code')).pipe(
    Match.when(Match.string, () => true),
    Match.orElse(() => false),
  )

const isErrnoException = (error: unknown): error is ErrnoException =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), hasStringCode),
    Match.orElse(() => false),
  )

const isEmptyNumber = (value: number): boolean =>
  Match.value(value).pipe(
    Match.when(0, () => true),
    Match.orElse(Number.isNaN),
  )

const isEmptyError = (error: unknown): error is undefined | null | '' | 0 | false =>
  Match.value(error).pipe(
    Match.when(Match.undefined, () => true),
    Match.when(Match.null, () => true),
    Match.when(Match.string, (text) => text.length === 0),
    Match.when(Match.number, isEmptyNumber),
    Match.when(Match.boolean, (value) => !value),
    Match.orElse(() => false),
  )

const formatErrnoException = (error: ErrnoException): string =>
  Match.value(error.stack).pipe(
    Match.when(hasText, (stack) => `${error.name}: ${error.code} (${error.syscall}) ${stack}`),
    Match.orElse(() => `${error.name}: ${error.code} (${error.syscall})`),
  )

const formatError = (error: Error): string =>
  Match.value(error.stack).pipe(
    Match.when(hasText, (stack) => `${error.name}: ${error.message}\n${stack}`),
    Match.orElse(() => `${error.name}: ${error.message}`),
  )

const isJsonPrimitive = (value: unknown): value is number | boolean | bigint =>
  Match.value(value).pipe(
    Match.when(Match.number, () => true),
    Match.when(Match.boolean, () => true),
    Match.when(Match.bigint, () => true),
    Match.orElse(() => false),
  )

const jsonText = <A = unknown>(error: A): string | undefined =>
  Result.getOrElse(
    Result.try({
      try: () => textIfNonEmpty(JSON.stringify(error)),
      catch: () => undefined,
    }),
    () => undefined,
  )

const isNonPlaceholderText = (text: string): boolean =>
  Match.value({ hasLength: text.length > 0, isPlaceholder: text === '[object Object]' }).pipe(
    Match.when({ hasLength: true, isPlaceholder: false }, () => true),
    Match.orElse(() => false),
  )

const isUsableText = (value: unknown): value is string =>
  Match.value(value).pipe(
    Match.when(Match.string, isNonPlaceholderText),
    Match.orElse(() => false),
  )

const usableText = <A = unknown>(value: A): string => (isUsableText(value) ? value : '')

const objectToStringText = (value: object): string =>
  Match.value(fieldOf(value, 'toString')).pipe(
    Match.when(Match.instanceOf(Function), (callable) =>
      Result.getOrElse(
        Result.try({
          try: () => usableText(Reflect.apply(callable, value, [])),
          catch: () => '',
        }),
        () => '',
      )),
    Match.orElse(() => ''),
  )

const isObjectType = (cause: unknown): cause is object => typeof cause === 'object'

const isNonNullObjectType = <A = unknown>(error: A): error is A & object => error !== null && isObjectType(error)

const toStringText = <A = unknown>(error: A): string => (isNonNullObjectType(error) ? objectToStringText(error) : '')

const stringifyRest = <A = unknown>(error: A): string =>
  Option.match(Option.filter(Option.fromUndefinedOr(jsonText(error)), hasText), {
    onNone: () => toStringText(error),
    onSome: (json) => json,
  })

function primitiveJsonOf<A = unknown>(error: A): string | undefined {
  return Option.getOrUndefined(
    Option.filter(Option.some(error), isJsonPrimitive).pipe(
      Option.map((primitive) => JSON.stringify(primitive)),
    ),
  )
}

const stringifyNonError = <A = unknown>(error: A): string => typeof error === 'string' ? error : nonStringTextOf(error)

function nonStringTextOf<A = unknown>(error: A): string {
  return primitiveJsonOf(error) ?? stringifyRest(error)
}

const errorText = (error: Error): string =>
  Match.value(error).pipe(
    Match.when(isErrnoException, formatErrnoException),
    Match.orElse(() => formatError(error)),
  )


const errorNameOf = (value: object): string | undefined =>
  Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), (error) => textIfNonEmpty(error.name)),
    Match.orElse(() => undefined),
  )

const tagOf = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, '_tag'))).pipe(
    Match.when(hasText, (tag) => tag),
    Match.orElse(() => errorNameOf(value)),
  )

const textWithNested = (own: string | undefined, nested: string | undefined): string | undefined =>
  Match.value(own).pipe(
    Match.when(hasText, (text) => appendNested(text, nested)),
    Match.orElse(() => nested),
  )

const appendNested = (own: string, nested: string | undefined): string =>
  Match.value(nested).pipe(
    Match.when(hasText, (text) => `${own}: ${text}`),
    Match.orElse(() => own),
  )

const errorMessage = (error: Error): string | undefined =>
  Match.value(error.message.length > 0).pipe(
    Match.when(true, () => error.message),
    Match.orElse(() => tagOf(error)),
  )

const errorMessageOrTag = (value: object): string | undefined =>
  Match.value(value).pipe(
    Match.when(Match.instanceOf(Error), errorMessage),
    Match.orElse(() => tagOf(value)),
  )

const messageText = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, 'message'))).pipe(
    Match.when(hasText, (message) => message),
    Match.orElse(() => errorMessageOrTag(value)),
  )

const ownCauseText = (value: object): string | undefined =>
  Match.value(textIfNonEmpty(fieldOf(value, 'reason'))).pipe(
    Match.when(hasText, (reason) => reason),
    Match.orElse(() => messageText(value)),
  )

const isPastDepth = (depth: number): boolean => depth > 4

const isMissingCause = <A = unknown>(cause: A): boolean => cause === undefined || cause === null

function causeText<A = unknown>(cause: A, depth: number): string | undefined {
  return Boolean.match(isPastDepth(depth), {
    onTrue: () => undefined,
    onFalse: () => missingCauseTextOf(cause, depth),
  })
}

function missingCauseTextOf<A = unknown>(cause: A, depth: number): string | undefined {
  return Boolean.match(isMissingCause(cause), {
    onTrue: () => undefined,
    onFalse: () => causeTextOfValue(cause, depth),
  })
}

function causeTextOfValue<A = unknown>(cause: A, depth: number): string | undefined {
  return Match.value(cause).pipe(
    Match.when(Match.string, (text) => textIfNonEmpty(text)),
    Match.orElse((value) => objectCauseTextOf(value, depth)),
  )
}

function objectCauseTextOf<A = unknown>(cause: A, depth: number): string | undefined {
  return Option.getOrUndefined(
    Option.map(
      Option.filter(Option.some(cause), isObjectType),
      (object) => textWithNested(ownCauseText(object), causeText(fieldOf(object, 'cause'), depth + 1)),
    ),
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')

  const WORDS = Schema.Array(Schema.String)

  const errorOf = (parts: ReadonlyArray<string>) =>
    Object.assign(new Error(parts.slice(1).join(' ')), { name: parts[0] ?? 'Error' })

  const partAt = (parts: ReadonlyArray<string>, index: number) => parts[index] ?? ''

  const errnoOf = (parts: ReadonlyArray<string>): Error & { readonly code: string; readonly syscall: string } =>
    Object.assign(new Error(parts.slice(2).join(' ')), {
      name: 'Error',
      code: partAt(parts, 0),
      syscall: partAt(parts, 1),
    })

  const nestedOf = (parts: ReadonlyArray<string>) =>
    Object.assign(new Error(parts.slice(1).join(' ')), {
      name: parts[0] ?? 'Error',
      cause: Object.assign(new Error(parts.slice(2).join(' ')), { name: 'CausedBy' }),
    })

  const mentionsAll = (text: string, needles: ReadonlyArray<string>): boolean => {
    const present = needles.filter((needle) => needle.length > 0)
    return present.every((needle) => text.includes(needle))
  }

  const decodesEmptyAndPresent = (parts: ReadonlyArray<string>) => {
    const absent = [undefined, null, '', 0, false].every((empty) => Option.isNone(S.decodeOption(ErrorText)(empty)))
    return absent && Option.isSome(S.decodeOption(ErrorText)(errorOf(parts)))
  }

  it.prop('∀cause_ErrorText_∋NameAndMessage', [WORDS], ([parts]) => {
    const error = errorOf(parts)
    return Option.match(S.decodeOption(ErrorText)(error), {
      onNone: () => false,
      onSome: (text) => text.includes(error.name) && text.includes(error.message),
    })
  })

  it.prop('∀text_ErrorText_≡StringPassthrough', [WORDS], ([parts]) => {
    const source = parts.join(' ')
    return Option.match(S.decodeOption(ErrorText)(source), {
      onNone: () => source.length === 0,
      onSome: (rendered) => rendered === source,
    })
  })

  it.prop('∀cause_ErrorText_∅ForAbsent∧∋ForPresent', [WORDS], ([parts]) => decodesEmptyAndPresent(parts))

  it.prop('∀cause_ErrorText_∋ErrnoCode', [WORDS], ([parts]) => {
    const error = errnoOf(parts)
    return Option.match(S.decodeOption(ErrorText)(error), {
      onNone: () => false,
      onSome: (text) => text.startsWith(`${error.name}: ${error.code} (${error.syscall})`),
    })
  })

  it.prop('∀cause_CauseText_∋NestedMessage', [WORDS], ([parts]) => {
    const error = nestedOf(parts)
    const inner = error.cause instanceof Error ? error.cause.message : ''
    return Option.match(S.decodeOption(CauseText)(error), {
      onNone: () => error.message.length === 0 && inner.length === 0,
      onSome: (text) => mentionsAll(text, [error.message, inner]),
    })
  })
}