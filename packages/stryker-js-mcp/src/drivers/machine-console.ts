import { Reports } from '@systemfsoftware/stryker-js-contracts'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

export const layer: Layer.Layer<Reports.MachineConsole> = Layer.effect(
  Reports.MachineConsole,
  Clock.clockWith((clock) => Effect.succeed(Reports.MachineConsole.of(Reports.machineConsoleOf(clock)))),
)

export const captureLayer: Layer.Layer<never, never, Reports.MachineConsole> = Layer.effect(
  Console.Console,
  Effect.map(Reports.MachineConsole, (machine) => {
    machine.reset()
    return machine.console
  }),
)
