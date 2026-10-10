import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'

const SEPARATOR = ': '
const REMEMBERED: Mutant.SettledReasonCodeValue = 'remembered'
const TIMED_OUT: Mutant.SettledReasonCodeValue = 'timed-out'

export const statusReasonTextOf = ({ statusReason }: Mutant.StatusReasonValue): string =>
  `${statusReason.code}${SEPARATOR}${statusReason.detail}`

const withoutCode = (text: string, code: Mutant.SettledReasonCodeValue): string =>
  text.startsWith(`${code}${SEPARATOR}`) ? text.slice(code.length + SEPARATOR.length) : text

export const timeoutDetailOf = (reason: string): string => withoutCode(withoutCode(reason, REMEMBERED), TIMED_OUT)
