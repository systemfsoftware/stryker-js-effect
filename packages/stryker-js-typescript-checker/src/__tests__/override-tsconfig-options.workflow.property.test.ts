import { describe } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { OverrideTsconfigOptionsCommand } from '../CheckerCommands.schema.js'
import { overrideTsconfigOptions } from '../override-tsconfig-options.workflow.js'

type JsonValue = S.Schema.Type<typeof S.Json>
type JsonObject = { readonly [key: string]: JsonValue }

const decided = (command: OverrideTsconfigOptionsCommand): string =>
  Result.match(overrideTsconfigOptions(command), {
    onFailure: (refused) => refused,
    onSuccess: (decision) => decision,
  }).text

const parsedOf = (text: string): Option.Option<JsonObject> =>
  Option.flatMap(
    S.decodeOption(S.fromJsonString(S.Json))(text),
    (value) =>
      Option.liftPredicate(value, (parsed): parsed is JsonObject =>
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)),
  )

describe('overrideTsconfigOptions', (it) => {
  it.prop(
    '∀command_Override_≡NonCompilerOptionsKeysPreserved',
    { of: [OverrideTsconfigOptionsCommand], subject: decided },
    (subject, [command]) => {
      const output = parsedOf(subject(command))
      return Option.match(output, {
        onNone: () => false,
        onSome: (overridden) => {
          const document = command.document
          const preserved = Object.entries(document).every(([key, value]) =>
            key === 'compilerOptions' || key === 'references' || Equal.equals(overridden[key], value)
          )
          const referencesHeld = command.buildMode
            ? Equal.equals(overridden['references'], document['references'])
            : !Object.hasOwn(overridden, 'references')
          return preserved && referencesHeld && Object.hasOwn(overridden, 'compilerOptions')
        },
      })
    },
  )
})
