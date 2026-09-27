import type { Node } from '@systemfsoftware/stryker-ignorer-interface'
import { Schema as S, SchemaGetter } from 'effect'

import { MutatorName } from './Mutant.schema.js'
import { Definition, Example, Id, Provider, Tier } from './MutatorCatalog.schema.js'

export interface MutatorContext {
  readonly parent: Node | undefined
  readonly grandParent: Node | undefined
  readonly ancestors: readonly Node[]
}

export type Mutator = (node: Node, context: MutatorContext) => Iterable<Node>

const isMutator = (value: unknown): value is Mutator => typeof value === 'function'

const implementsNothing: Mutator = () => []

const mutatorArbitrary = S.link<Mutator>()(S.Null, {
  decode: SchemaGetter.transform((): Mutator => implementsNothing),
  encode: SchemaGetter.transform(() => null),
})

export const Implementation = S.declare<Mutator>(isMutator, { toCodecArbitrary: () => mutatorArbitrary })

export const ProviderEntry = S.Struct({
  id: Id,
  name: MutatorName,
  tier: Tier,
  definition: Definition,
  examples: S.NonEmptyArray(Example),
  implementation: Implementation,
})
export type ProviderEntry = typeof ProviderEntry.Type

export const Contribution = S.Struct({
  namespace: Provider,
  entries: S.NonEmptyArray(ProviderEntry),
})
export type Contribution = typeof Contribution.Type
