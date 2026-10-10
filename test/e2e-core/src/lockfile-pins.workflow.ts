import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Rec from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  LockfilePins,
  LockfilePinsPartial,
  LockfilePinsResolved,
  PnpmListing,
  type PnpmNode,
  type PnpmProject,
} from './lockfile-pins.schema.js'

export class LockfilePinsCommand extends S.TaggedClass<LockfilePinsCommand>()('LockfilePinsCommand', {
  listing: PnpmListing,
  workspaceNames: S.Array(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface Occurrence {
  readonly name: string
  readonly version: string
  readonly resolved: string | undefined
}

const PROJECT_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

const REGISTRY_URL = 'https://registry.npmjs.org/'
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const NO_NODES: Readonly<Record<string, PnpmNode>> = {}

const nodesOf = (nodes: Readonly<Record<string, PnpmNode>> | undefined): Readonly<Record<string, PnpmNode>> =>
  Option.getOrElse(Option.fromUndefinedOr(nodes), () => NO_NODES)

const nodesIn: (nodes: Readonly<Record<string, PnpmNode>>) => ReadonlyArray<PnpmNode> = (nodes) =>
  Arr.flatMap(Object.values(nodes), (node) => [
    node,
    ...nodesIn(nodesOf(node.dependencies)),
    ...nodesIn(nodesOf(node.optionalDependencies)),
  ])

const occurrenceOf = (node: PnpmNode): Occurrence => ({
  name: node.from,
  version: node.version,
  resolved: node.resolved,
})

const occurrencesIn = (projects: ReadonlyArray<PnpmProject>): ReadonlyArray<Occurrence> =>
  Arr.flatMap(
    projects,
    (project) => Arr.flatMap(PROJECT_FIELDS, (field) => Arr.map(nodesIn(nodesOf(project[field])), occurrenceOf)),
  )

const isPinnable = (occurrence: Occurrence): boolean =>
  Boolean.and(
    Option.exists(Option.fromUndefinedOr(occurrence.resolved), (resolved) => resolved.startsWith(REGISTRY_URL)),
    EXACT_VERSION.test(occurrence.version),
  )

const namesOf = (occurrences: ReadonlyArray<Occurrence>): ReadonlyArray<string> =>
  Arr.dedupe(Arr.map(occurrences, (occurrence) => occurrence.name))

const pinOf = (occurrences: ReadonlyArray<Occurrence>, name: string): Option.Option<readonly [string, string]> => {
  const forName = Arr.filter(occurrences, (occurrence) => occurrence.name === name)
  const versions = Arr.dedupe(Arr.map(forName, (occurrence) => occurrence.version))
  return Boolean.match(Boolean.and(Arr.every(forName, isPinnable), versions.length === 1), {
    onTrue: () => Option.map(Arr.head(versions), (version): readonly [string, string] => [name, version]),
    onFalse: () => Option.none<readonly [string, string]>(),
  })
}

const workspacesIn = (command: LockfilePinsCommand): HashSet.HashSet<string> =>
  HashSet.fromIterable([...command.workspaceNames, ...Arr.map(command.listing, (project) => project.name)])

const pinsOf = (command: LockfilePinsCommand): LockfilePins => {
  const occurrences = occurrencesIn(command.listing)
  const workspaces = workspacesIn(command)
  const eligible = Arr.filter(namesOf(occurrences), (name) => Boolean.not(HashSet.has(workspaces, name)))
  const pins = Object.fromEntries(
    Arr.getSomes(Arr.map(Arr.sort(eligible, Order.String), (name) => pinOf(occurrences, name))),
  )
  const withheld = Arr.filter(eligible, (name) => Boolean.not(Rec.has(pins, name)))
  return Boolean.match(withheld.length === 0, {
    onTrue: () => LockfilePinsResolved.make({ pins }),
    onFalse: () => LockfilePinsPartial.make({ pins }),
  })
}

const decide = (command: LockfilePinsCommand): Result.Result<LockfilePins, never> => Result.succeed(pinsOf(command))

export const lockfilePins = Workflow.make({
  command: LockfilePinsCommand,
  decision: LockfilePins,
  error: S.Never,
  decide,
})
