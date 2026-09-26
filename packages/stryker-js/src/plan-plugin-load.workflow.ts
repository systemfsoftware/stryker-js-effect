import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { PluginDescriptorSchema } from './Plugins.schema.js'

const PluginLoadTypeId = Symbol.for('@systemfsoftware/stryker-js/PluginLoadDecision')
type PluginLoadTypeId = typeof PluginLoadTypeId

export const PluginDeclarationSchema = S.Struct({
  plugin: PluginDescriptorSchema,
  moduleName: S.String,
  entryIndex: S.Int,
})
export type PluginDeclaration = typeof PluginDeclarationSchema.Type

export const PluginShadowingSchema = S.Struct({
  kind: S.String,
  name: S.String,
  shadowedIndex: S.Int,
  winnerIndex: S.Int,
})
export type PluginShadowing = typeof PluginShadowingSchema.Type

export class PluginLoadCommand extends S.TaggedClass<PluginLoadCommand>()('PluginLoadCommand', {
  declarations: S.Array(PluginDeclarationSchema),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    declarations: 'stryker.plugin_load.declarations',
  } as const
}

export class PluginDeclarationsPlanned extends S.TaggedClass<PluginDeclarationsPlanned>()(
  'PluginDeclarationsPlanned',
  {
    winners: S.Array(PluginDeclarationSchema),
    shadowings: S.Array(PluginShadowingSchema),
  },
) {
  readonly [PluginLoadTypeId] = PluginLoadTypeId
}

export class NoPluginDeclarations extends S.TaggedClass<NoPluginDeclarations>()('NoPluginDeclarations', {}) {
  readonly [PluginLoadTypeId] = PluginLoadTypeId
}

export const PluginLoadDecision = S.Union([PluginDeclarationsPlanned, NoPluginDeclarations])
export type PluginLoadDecision = typeof PluginLoadDecision.Type

interface ShadowingState {
  readonly seen: HashMap.HashMap<string, { readonly position: number; readonly entryIndex: number }>
  readonly shadowings: readonly PluginShadowing[]
}

const keyOf = (declaration: PluginDeclaration): string => `${declaration.plugin.kind}:${declaration.plugin.name}`

const shadowingStep = (state: ShadowingState, declaration: PluginDeclaration, position: number): ShadowingState => ({
  seen: HashMap.set(state.seen, keyOf(declaration), { position, entryIndex: declaration.entryIndex }),
  shadowings: Option.getOrElse(
    Option.map(HashMap.get(state.seen, keyOf(declaration)), (previous) => [
      ...state.shadowings,
      {
        kind: declaration.plugin.kind,
        name: declaration.plugin.name,
        shadowedIndex: previous.entryIndex,
        winnerIndex: declaration.entryIndex,
      },
    ]),
    () => state.shadowings,
  ),
})

const shadowingStateOf = (declarations: readonly PluginDeclaration[]): ShadowingState =>
  declarations.reduce<ShadowingState>(shadowingStep, { seen: HashMap.empty(), shadowings: [] })

const winnersOf = (declarations: readonly PluginDeclaration[]): readonly PluginDeclaration[] =>
  declarations.filter((declaration, position) =>
    Option.match(HashMap.get(shadowingStateOf(declarations).seen, keyOf(declaration)), {
      onNone: () => false,
      onSome: (entry) => entry.position === position,
    })
  )

export const planPluginLoad = Workflow.make({
  command: PluginLoadCommand,
  decision: PluginLoadDecision,
  error: S.Never,
  decide: (command): Result.Result<PluginLoadDecision, never> =>
    Result.succeed(
      Boolean.match(command.declarations.length === 0, {
        onTrue: () => NoPluginDeclarations.make({}),
        onFalse: () =>
          PluginDeclarationsPlanned.make({
            winners: [...winnersOf(command.declarations)],
            shadowings: [...shadowingStateOf(command.declarations).shadowings],
          }),
      }),
    ),
})
