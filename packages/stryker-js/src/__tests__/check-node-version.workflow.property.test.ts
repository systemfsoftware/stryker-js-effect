import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  checkNodeVersion,
  CheckNodeVersionCommand,
  NodeVersionRejected,
  NodeVersionSupported,
} from '../check-node-version.workflow.js'

const decidesSupported = (subject: typeof checkNodeVersion, version: string): boolean =>
  Result.match(subject(CheckNodeVersionCommand.make({ version })), {
    onFailure: () => false,
    onSuccess: (decision) => S.is(NodeVersionSupported)(decision),
  })

const decidesRejected = (subject: typeof checkNodeVersion, version: string): boolean =>
  Result.match(subject(CheckNodeVersionCommand.make({ version })), {
    onFailure: () => false,
    onSuccess: (decision) => S.is(NodeVersionRejected)(decision),
  })

describe('checkNodeVersion', () => {
  const Component = S.Literals(['0', '1', '5', '19', '20', '21', '24', '100', '007', 'x', ''])
  const VersionParts = S.Tuple([S.Literals(['v', '']), Component, Component, Component])

  const versionOf = (parts: typeof VersionParts.Type): string => {
    const [prefix, major, minor, patch] = parts
    return `${prefix}${major}.${minor}.${patch}`
  }

  const referenceSupports = (parts: typeof VersionParts.Type): boolean => {
    const [, major, minor, patch] = parts
    const numeric = [major, minor, patch].every((part) => /^\d+$/.test(part))
    return numeric && Number(major) >= 20
  }

  it.prop(
    '∀parts_Command_≡SupportedIffMajorAtLeast20',
    { of: [VersionParts], subject: checkNodeVersion },
    (subject, [parts]) => {
      const version = versionOf(parts)
      return referenceSupports(parts)
        ? decidesSupported(subject, version)
        : decidesRejected(subject, version)
    },
  )

  it.prop(
    '∀parts_Command_≡PreReleaseKeepsBaseVerdict',
    { of: [VersionParts], subject: checkNodeVersion },
    (subject, [parts]) =>
      decidesSupported(subject, versionOf(parts)) === decidesSupported(subject, `${versionOf(parts)}-rc.1`),
  )
})
