import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { admitCaseSensitivity, CaseSensitivityCommand } from '../admit-case-sensitivity.workflow.js'

const commandArb = Arbitrary.schema(CaseSensitivityCommand)

type Probe = CaseSensitivityCommand['probes'][number]

const tagOf = (subject: typeof admitCaseSensitivity, probes: ReadonlyArray<Probe>) =>
  Result.getOrUndefined(subject(CaseSensitivityCommand.make({ probes })))?._tag

const another = (value: number) => value === 1 ? 2 : 1

const reachingItself = (probe: Probe): Probe => ({
  own: probe.own,
  swapped: { _tag: 'SwappedFound', identity: probe.own },
})

const withIdentityUnknown = (probe: Probe): Probe => ({
  own: { dev: probe.own.dev, ino: Option.none() },
  swapped: { _tag: 'SwappedFound', identity: { dev: probe.own.dev, ino: probe.own.ino } },
})

const foldedPlus = (
  subject: typeof admitCaseSensitivity,
  command: CaseSensitivityCommand,
  extra: (first: Probe) => Probe,
) =>
  Option.match(Option.fromUndefinedOr(command.probes[0]), {
    onNone: () => tagOf(subject, []) === 'CaseFolded',
    onSome: (first) => tagOf(subject, [...command.probes.map(reachingItself), extra(first)]) === 'CaseToldApart',
  })

describe('admitCaseSensitivity', () => {
  it.prop(
    '∀c_ProbesWhoseSwappedNamesReachTheirOwnFile_≡CaseFolded',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) => tagOf(subject, command.probes.map(reachingItself)) === 'CaseFolded',
  )

  it.prop(
    '∀c_ProbesWhoseFileIdentityIsUnknown_≡CaseFolded',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) => tagOf(subject, command.probes.map(withIdentityUnknown)) === 'CaseFolded',
  )

  it.prop(
    '∀c_FoldedProbesPlusOneWhoseSwappedNameIsMissing_≡CaseToldApart',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) =>
      foldedPlus(subject, command, (first) => ({ own: first.own, swapped: { _tag: 'SwappedMissing' } })),
  )

  it.prop(
    '∀c_FoldedProbesPlusOneReachingAnotherDevice_≡CaseToldApart',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) =>
      foldedPlus(subject, command, (first) => ({
        own: first.own,
        swapped: { _tag: 'SwappedFound', identity: { dev: another(first.own.dev), ino: first.own.ino } },
      })),
  )

  it.prop(
    '∀c_FoldedProbesPlusOneReachingAnotherInode_≡CaseToldApart',
    { of: [commandArb], subject: admitCaseSensitivity },
    (subject, [command]) =>
      foldedPlus(subject, command, (first) => {
        const ino = Option.getOrElse(first.own.ino, () => 0)
        return {
          own: { dev: first.own.dev, ino: Option.some(ino) },
          swapped: { _tag: 'SwappedFound', identity: { dev: first.own.dev, ino: Option.some(another(ino)) } },
        }
      }),
  )
})
