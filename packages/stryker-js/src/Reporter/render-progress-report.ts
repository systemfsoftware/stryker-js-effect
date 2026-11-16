import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'

import { isBarComplete, type ProgressBarState, type ProgressTally } from './progress-report.schema.js'

const PROGRESS_BAR_FORMAT =
  'Mutation testing  [:bar] :percent (elapsed: :et, remaining: :etc) :tested/:mutants Mutants tested (:survived survived, :timedOut timed out)'

const PROGRESS_BAR_WIDTH = 50
const PROGRESS_BAR_COMPLETE = '='
const PROGRESS_BAR_INCOMPLETE = ' '

const floor = Math.floor
const min = Math.min

const secondsBetween = (now: number, startedAt: number): number => floor((now - startedAt) / 1000)

const formatTime = (timeInSeconds: number): string => {
  const hours = floor(timeInSeconds / 3600)
  const minutes = floor((timeInSeconds % 3600) / 60)
  return Match.value(hours > 0).pipe(
    Match.when(true, () => `~${hours}h ${minutes}m`),
    Match.when(false, () =>
      Match.value(minutes > 0).pipe(
        Match.when(true, () => `~${minutes}m`),
        Match.when(false, () => '<1m'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
}

const remainingSeconds = (tally: ProgressTally, now: number): number =>
  floor((secondsBetween(now, tally.startedAt) / tally.ticks) * (tally.total - tally.ticks))

const positiveTimeLabel = (remaining: number): string =>
  Match.value(remaining > 0).pipe(
    Match.when(true, () => formatTime(remaining)),
    Match.when(false, () => 'n/a'),
    Match.exhaustive,
  )

const remainingLabel = (tally: ProgressTally, now: number): string => {
  const remaining = remainingSeconds(tally, now)
  return Boolean.match(Number.isFinite(remaining), {
    onTrue: () => positiveTimeLabel(remaining),
    onFalse: () => 'n/a',
  })
}

const progressData = (tally: ProgressTally, now: number): Record<string, string | number> => ({
  survived: tally.survived,
  timedOut: tally.timedOut,
  tested: tally.tested,
  mutants: tally.mutants,
  total: tally.total,
  ticks: tally.ticks,
  et: formatTime(secondsBetween(now, tally.startedAt)),
  etc: remainingLabel(tally, now),
})

const formatBar = (bar: ProgressBarState, data: Readonly<Record<string, string | number>>): string => {
  const ratio = Match.value(bar.total === 0).pipe(
    Match.when(true, () => 0),
    Match.when(false, () => min(bar.curr / bar.total, 1)),
    Match.exhaustive,
  )
  const filled = floor(ratio * PROGRESS_BAR_WIDTH)
  const filledBar = PROGRESS_BAR_COMPLETE.repeat(filled) + PROGRESS_BAR_INCOMPLETE.repeat(PROGRESS_BAR_WIDTH - filled)
  const percent = `${floor(ratio * 100).toString().padStart(3, ' ')}%`
  const printed = PROGRESS_BAR_FORMAT.replace(':bar', filledBar).replace(':percent', percent)
  return Object.entries(data).sort(([left], [right]) => right.length - left.length).reduce(
    (out, [key, value]) => out.replaceAll(`:${key}`, String(value)),
    printed,
  )
}

export const renderProgressTick = (
  tick: { readonly bar: ProgressBarState; readonly tally: ProgressTally; readonly now: number },
): string =>
  `\r${formatBar(tick.bar, progressData(tick.tally, tick.now))}${
    Boolean.match(isBarComplete(tick.bar), { onTrue: () => '\n', onFalse: () => '' })
  }`

export const renderProgressLineBreak = (): string => '\n'

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const S = await import('effect/Schema')
  const { ProgressBarStateSchema, ProgressTallySchema } = await import('./progress-report.schema.js')

  const tickInputSchema = S.Struct({
    bar: ProgressBarStateSchema,
    tally: ProgressTallySchema,
    now: S.Finite,
  })

  it.prop(
    '∀t_ProgressTick_≡FixedWidthBarAndNewlineIffComplete',
    { of: [tickInputSchema], subject: renderProgressTick },
    (subject, [input]) => {
      const rendered = subject(input)
      const opening = rendered.indexOf('[')
      const closing = rendered.indexOf(']')
      return [
        rendered.startsWith('\r'),
        opening >= 0,
        closing > opening,
        closing - opening - 1 === PROGRESS_BAR_WIDTH,
        rendered.endsWith('\n') === (input.bar.curr >= input.bar.total),
        rendered.includes(
          `${input.tally.tested}/${input.tally.mutants} Mutants tested (${input.tally.survived} survived, ${input.tally.timedOut} timed out)`,
        ),
      ].every((holds) => holds)
    },
  )
}
