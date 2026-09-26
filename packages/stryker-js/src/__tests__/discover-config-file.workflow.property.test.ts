import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  ConfigDiscoveryCommand,
  ConfigFileMissing,
  ConfigFileRead,
  ConfigFileRefused,
  ConfigFileRequest,
  discoverConfigFile,
  NoConfigFile,
} from '../run/discover-config-file.workflow.js'

const commandArb = Arbitrary.schema(ConfigDiscoveryCommand)

const requestedCommandArb = Arbitrary.all({
  context: Arbitrary.schema(S.Literals(['cli', 'extends'])),
  file: Arbitrary.schema(S.String),
  kind: Arbitrary.schema(S.Literals(['supported', 'legacy', 'unsupported'])),
  exists: Arbitrary.schema(S.Boolean),
}).pipe(
  Arbitrary.map(({ context, file, kind, exists }) =>
    ConfigDiscoveryCommand.make({
      context,
      requested: ConfigFileRequest.make({ file, kind, exists }),
    })
  ),
)

const discoveredCommandArb = Arbitrary.all({
  context: Arbitrary.schema(S.Literals(['cli', 'extends'])),
  discovered: Arbitrary.schema(S.String),
  legacyPresent: Arbitrary.schema(S.String),
}).pipe(
  Arbitrary.map(({ context, discovered, legacyPresent }) =>
    ConfigDiscoveryCommand.make({ context, discovered, legacyPresent })
  ),
)

describe('discoverConfigFile', () => {
  it.prop(
    '∀c_Requested_≡KindAndPresencePickTheDecision',
    { of: [requestedCommandArb], subject: discoverConfigFile },
    (subject, [command]) => {
      const requested = command.requested
      if (requested === undefined) {
        return false
      }
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      if (requested.kind === 'supported') {
        return requested.exists
          ? S.is(ConfigFileRead)(decision) && decision.file === requested.file
          : S.is(ConfigFileMissing)(decision) && decision.file === requested.file
      }
      return S.is(ConfigFileRefused)(decision) && decision.file === requested.file && decision.hint.length > 0
    },
  )

  it.prop(
    '∀c_Discovered_≡DiscoveredWinsOverLegacy',
    { of: [discoveredCommandArb], subject: discoverConfigFile },
    (subject, [command]) => {
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(ConfigFileRead)(decision) &&
        decision.file === command.discovered &&
        decision.shadowedLegacyWarning !== undefined
    },
  )

  it.prop(
    '∀c_Empty_≡AbsentRequestedAndDiscoveredIsNoConfig',
    { of: [commandArb], subject: discoverConfigFile },
    (subject, [command]) => {
      if (command.requested !== undefined || command.discovered !== undefined) {
        return true
      }
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return S.is(NoConfigFile)(decision) ||
        (S.is(ConfigFileRefused)(decision) && decision.file === command.legacyPresent)
    },
  )
})
