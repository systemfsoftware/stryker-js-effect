import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import type { CurrentVerdict } from '../IncrementalDiff.schema.js'
import type { CheckerComponents, TestedComponents, VerdictKey } from '../verdict-store/VerdictEntry.schema.js'
import { verdictKeyOf } from '../verdict-store/VerdictKey.js'

export const testedComponentsOf = (current: CurrentVerdict): Option.Option<TestedComponents> =>
  Option.map(
    Option.all({
      coveringTestIds: Option.fromUndefinedOr(current.coveringTestIds),
      closureDigest: Option.fromUndefinedOr(current.closureDigest),
      checkerConfigDigest: Option.fromUndefinedOr(current.checkerConfigDigest),
    }),
    (parts): TestedComponents => ({ _tag: 'tested', ...current.shared, ...parts }),
  )

export const checkerComponentsOf = (current: CurrentVerdict): Option.Option<CheckerComponents> =>
  Option.map(
    Option.fromUndefinedOr(current.programDigest),
    (programDigest): CheckerComponents => ({ _tag: 'checker', ...current.shared, programDigest }),
  )

export const currentKeysOf = (current: CurrentVerdict): ReadonlyArray<VerdictKey> =>
  Arr.getSomes([
    Option.map(testedComponentsOf(current), verdictKeyOf),
    Option.map(checkerComponentsOf(current), verdictKeyOf),
  ])
