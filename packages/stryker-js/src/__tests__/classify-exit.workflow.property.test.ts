import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyExit, ClassifyExitCommand } from '../classify-exit.workflow.js'

const codeOf = (exitClass: Plugin.ExitClass): number =>
  Match.value(exitClass).pipe(
    Match.when('VerdictFail', () => 1),
    Match.when('ConfigError', () => 2),
    Match.when('RuntimeError', () => 3),
    Match.when('InternalError', () => 4),
    Match.exhaustive,
  )

const worseOf = (first: Plugin.ExitClass | null, second: Plugin.ExitClass): Plugin.ExitClass =>
  first === null
    ? second
    : Boolean.match(codeOf(first) >= codeOf(second), {
      onTrue: () => first,
      onFalse: () => second,
    })

describe('classifyExit', () => {
  it.prop(
    '∀pending_Command_≡HighestSeverity',
    { of: [S.Array(Plugin.ExitClass)], subject: classifyExit },
    (subject, [pending]) =>
      Result.match(subject(ClassifyExitCommand.make({ pending: [...pending] })), {
        onFailure: () => false,
        onSuccess: (decision) => decision.exitClass === pending.reduce<Plugin.ExitClass | null>(worseOf, null),
      }),
  )
})
