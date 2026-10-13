import { Blueprint } from '@systemfsoftware/effect-cell-types'
import type { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Queue from 'effect/Queue'
import type * as Scope from 'effect/Scope'

import { MachineConsole } from '../reporting/machine-console.service.js'
import { RunEnvironment, type RunEnvironmentShape } from '../run/RunEnvironment.service.js'
import type { EnginePorts } from '../run/StageServices.service.js'
import { makeRerunStageHandle, type RerunStageHandle } from './rerun-stage.handle.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/Mcp/RerunStageBlueprint')
export type TypeId = typeof TypeId

export interface RerunStageSpec {
  readonly environment: RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent.RunEvent, Cause.Done>
}

const acquire = Effect.fnUntraced(function*(spec: RerunStageSpec) {
  const stage = yield* Layer.build(
    Layer.merge(
      RunEnvironment.layerStage(spec.environment, spec.events),
      MachineConsole.layerCapture.pipe(Layer.provide(MachineConsole.layer)),
    ),
  )
  return makeRerunStageHandle(stage)
})

const RerunStages = Blueprint.make<RerunStageSpec>()(TypeId).steps({
  steps: {},
  targets: { scoped: acquire },
})

export const scoped = (spec: RerunStageSpec): Effect.Effect<RerunStageHandle, never, Scope.Scope | EnginePorts> =>
  RerunStages.of(spec).scoped
