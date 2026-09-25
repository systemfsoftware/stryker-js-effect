import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Stdio from 'effect/Stdio'
import * as CliError from 'effect/unstable/cli/CliError'

import type { ModeSignal, OutputMode, ResolvedMode } from './output-mode.schema.js'
import { ModeConflictError, ResolveModeCommand, resolveOutputMode } from './resolve-output-mode.workflow.js'

const TOOL_VARIABLES = ['CLAUDECODE', 'CODEX_SANDBOX'] as const

interface FormatFlags {
  readonly text?: boolean
  readonly json?: boolean
}

type ProbeInput = (typeof ResolveModeCommand)['Encoded']

const JSON_FLAG = '--json'
const FORMAT_FLAG = '--format'

const formatFlagsOf = (argv: readonly string[]): FormatFlags => ({
  text: argv.some((argument) => argument === FORMAT_FLAG || argument.startsWith(`${FORMAT_FLAG}=`)),
  json: argv.includes(JSON_FLAG),
})

const resolvedMode = (
  mode: OutputMode,
  signal: ModeSignal,
  stdoutIsTTY: boolean,
): ResolvedMode => ({
  mode,
  signal,
  stdoutIsTTY,
})

const definedToolVars = (
  vars: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(vars ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

const envToolVars = (): Effect.Effect<Record<string, string>> =>
  Effect.forEach(TOOL_VARIABLES, (variable) =>
    Config.String(variable).pipe(
      Effect.option,
      Effect.map((value) => [variable, Option.getOrUndefined(value)] as const),
    )).pipe(Effect.map((entries) => definedToolVars(Object.fromEntries(entries))))

const probeInput = (
  command: FormatFlags,
): Effect.Effect<ProbeInput, never, Stdio.Stdio> =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    const envMode = yield* Config.String('STRYKER_MODE').pipe(Effect.option)
    const agent = yield* Config.String('AGENT').pipe(Effect.option)
    return {
      _tag: 'ResolveModeCommand',
      stdoutIsTTY: yield* stdio.stdoutIsTerminal,
      text: command.text,
      json: command.json,
      envMode: Option.getOrUndefined(envMode),
      agent: Option.getOrUndefined(agent),
      toolVars: yield* envToolVars(),
    }
  })

const outputModeProbeCell = Sandwich.named('stryker.output_mode_probe')(probeInput)
  .decide(resolveOutputMode)
  .write({
    HumanOutput: (human) => Effect.succeed(resolvedMode('human', human.signal, human.stdoutIsTTY)),
    MachineOutput: (machine) => Effect.succeed(resolvedMode('machine', machine.signal, machine.stdoutIsTTY)),
    ModeConflictError: (error) => Effect.fail(ModeConflictError.make(error)),
    CommandRejected: ({ issue }) =>
      Effect.fail(ModeConflictError.make({ option: 'format', value: 'probe', expected: issue })),
  })

const detectModeWithProbe = (
  flags: FormatFlags = {},
): Effect.Effect<ResolvedMode, CliError.CliError, Stdio.Stdio> =>
  outputModeProbeCell.run(flags).pipe(
    Effect.mapError((error) =>
      CliError.InvalidValue.make({
        option: error.option,
        value: error.value,
        expected: error.expected,
        kind: 'flag',
      })
    ),
  )

export interface OutputModeProbe {
  readonly detectMode: Effect.Effect<ResolvedMode, CliError.CliError>
}

class OutputModeProbeTag extends Context.Service<
  OutputModeProbeTag,
  OutputModeProbe
>()('@systemfsoftware/stryker-js/output-mode-probe.service/OutputModeProbeTag') {
  static readonly layer: Layer.Layer<OutputModeProbeTag, never, Stdio.Stdio> = Layer.effect(
    OutputModeProbeTag,
    Effect.map(Stdio.Stdio, (stdio) =>
      OutputModeProbeTag.of({
        detectMode: Effect.flatMap(stdio.args, (argv) =>
          detectModeWithProbe(formatFlagsOf(argv)).pipe(Effect.provideService(Stdio.Stdio, stdio))),
      })),
  )
}

const OutputModeProbe = OutputModeProbeTag

export { OutputModeProbe }

export const OutputModeProbeLive = OutputModeProbe.layer
