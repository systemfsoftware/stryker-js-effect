import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const SEPARATOR = ': '
const TIMED_OUT: Mutant.SettledReasonCodeValue = 'timed-out'

const decodeRemembered = S.decodeOption(Mutant.RememberedReason)

export const statusReasonTextOf = ({ statusReason }: Mutant.StatusReasonValue): string =>
  `${statusReason.code}${SEPARATOR}${statusReason.detail}`

const withoutRemembered = (text: string): string =>
  Option.getOrElse(Option.map(decodeRemembered(text), (remembered) => remembered.detail), () => text)

const withoutTimedOut = (text: string): string =>
  text.startsWith(`${TIMED_OUT}${SEPARATOR}`) ? text.slice(TIMED_OUT.length + SEPARATOR.length) : text

export const timeoutDetailOf = (reason: string): string => withoutTimedOut(withoutRemembered(reason))
