import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { type OutputMode, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as CliError from 'effect/cli/CliError'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Stdio from 'effect/Stdio'

import { OutputModeProbe } from '../output-mode-probe.service.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { ModeConflictError, ResolveModeCommand, resolveOutputMode } from '../resolve-output-mode.workflow.js'

const TOOL_VARIABLES = ['CLAUDECODE', 'CODEX_SANDBOX'] as const

interface FormatFlags {
  readonly text?: boolean
  readonly json?: boolean
}

type ProbeInput = (typeof ResolveModeCommand)['Encoded']

const FORMAT_FLAG = '--format'

const JSON_ARGUMENTS: Record<string, true> = {
  '--json': true,
  '--json=true': true,
  '--json=yes': true,
  '--json=on': true,
  '--json=1': true,
  '--json=y': true,
}

const formatFlagsOf = (argv: readonly string[]): FormatFlags => ({
  text: argv.some((argument) => argument === FORMAT_FLAG || argument.startsWith(`${FORMAT_FLAG}=`)),
  json: argv.some((argument) => JSON_ARGUMENTS[argument] === true),
})

const resolvedMode = (
  mode: OutputMode.OutputMode,
  signal: OutputMode.ModeSignal,
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

const probeInput = Effect.fn(SpanTaxonomy.Spans.outputModeProbeRead.name)(
  function*(
    command: FormatFlags,
  ): Effect.fn.Return<ProbeInput, never, Stdio.Stdio> {
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
  },
)

const outputModeProbeCell = Sandwich.named(SpanTaxonomy.Spans.outputModeProbe.name)(probeInput)
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

export const layer = Layer.effect(
  OutputModeProbe,
  Effect.map(Stdio.Stdio, (stdio) =>
    OutputModeProbe.of({
      detectMode: Effect.flatMap(stdio.args, (argv) =>
        detectModeWithProbe(formatFlagsOf(argv)).pipe(Effect.provideService(Stdio.Stdio, stdio))),
    })),
)
