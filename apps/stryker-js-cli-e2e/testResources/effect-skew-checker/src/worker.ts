import { CheckerRpcs, startRpcWorker, withLinkedSpan } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import effectManifest from 'effect/package.json' with { type: 'json' }

export const EFFECT_VERSION: string = effectManifest.version

const mutantIdsOf = (mutants: readonly { readonly id: string }[]): readonly string[] =>
  mutants.map((mutant) => mutant.id)

const CHECK_SPAN = 'skew.check'
const GROUP_SPAN = 'skew.group'

const checkerHandlers = CheckerRpcs.toLayer(
  Effect.succeed({
    check: ({ mutants }: { readonly mutants: readonly { readonly id: string }[] }) =>
      withLinkedSpan(
        CHECK_SPAN,
        { 'effect.version': EFFECT_VERSION },
        Effect.succeed(Object.fromEntries(mutantIdsOf(mutants).map((id) => [id, { status: 'passed' as const }]))),
      ),
    group: ({ mutants }: { readonly mutants: readonly { readonly id: string }[] }) =>
      withLinkedSpan(
        GROUP_SPAN,
        { 'effect.version': EFFECT_VERSION },
        Effect.succeed(mutantIdsOf(mutants).map((id) => [id])),
      ),
  }),
)

await startRpcWorker({
  rpcs: CheckerRpcs,
  handlers: checkerHandlers,
  schemaServices: Layer.empty,
  label: 'effect-skew checker worker',
})
