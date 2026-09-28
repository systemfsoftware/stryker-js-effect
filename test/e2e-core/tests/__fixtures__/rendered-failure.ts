import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import * as Option from 'effect/Option'

export const renderedFailureOf = <A = unknown>(cause: A): string =>
  Option.getOrElse(
    Option.map(ErrorText.errorTextOf(cause), (text) => text.text),
    () => 'a failure the error renderer cannot name',
  )
