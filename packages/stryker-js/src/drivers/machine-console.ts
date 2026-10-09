import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { MachineConsole, machineConsoleOf } from '../reporting/machine-console.service.js'

export const layer: Layer.Layer<MachineConsole> = Layer.effect(
  MachineConsole,
  Clock.clockWith((clock) => Effect.succeed(MachineConsole.of(machineConsoleOf(clock)))),
)

export const captureLayer: Layer.Layer<never, never, MachineConsole> = Layer.effect(
  Console.Console,
  Effect.map(MachineConsole, (machine) => {
    machine.reset()
    return machine.console
  }),
)
