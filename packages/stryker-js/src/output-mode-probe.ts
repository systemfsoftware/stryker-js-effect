import { Sandwich } from '@systemfsoftware/effect-cell-types'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Stdio from 'effect/Stdio'
import * as CliError from 'effect/unstable/cli/CliError'

import type { ResolvedMode } from './output-mode.js'
import {
  type ModeConflictError,
  ResolveModeCommand,
  type ResolveModeDecision,
  resolveOutputMode,
} from './resolve-output-mode.workflow.js'

const TOOL_VARIABLES = ['CLAUDECODE', 'CODEX_SANDBOX'] as const

interface FormatFlags {
  readonly text?: boolean
  readonly json?: boolean
}

const decisionToResolvedMode = (decision: ResolveModeDecision): ResolvedMode =>
  Match.value(decision).pipe(
    Match.tag(
      'HumanOutput',
      (human): ResolvedMode => ({
        mode: 'human',
        signal: human.signal,
        stdoutIsTTY: human.stdoutIsTTY,
      }),
    ),
    Match.tag(
      'MachineOutput',
      (machine): ResolvedMode => ({
        mode: 'machine',
        signal: machine.signal,
        stdoutIsTTY: machine.stdoutIsTTY,
      }),
    ),
    Match.exhaustive,
  )

interface ProbeInput {
  readonly stdoutIsTTY: boolean
  readonly text?: boolean | undefined
  readonly json?: boolean | undefined
  readonly envMode?: string | undefined
  readonly agent?: string | undefined
  readonly toolVars?: Readonly<Record<string, string | undefined>> | undefined
}

const definedToolVars = (
  vars: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(vars ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

const commandFor = (input: ProbeInput): ResolveModeCommand =>
  ResolveModeCommand.make({
    stdoutIsTTY: input.stdoutIsTTY,
    text: input.text,
    json: input.json,
    envMode: input.envMode,
    agent: input.agent,
    toolVars: definedToolVars(input.toolVars),
  })

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
      stdoutIsTTY: yield* stdio.stdoutIsTerminal,
      text: command.text,
      json: command.json,
      envMode: Option.getOrUndefined(envMode),
      agent: Option.getOrUndefined(agent),
      toolVars: yield* envToolVars(),
    }
  })

const outputModeProbeCell = Sandwich.read((command: FormatFlags) => probeInput(command))
  .decode(Sandwich.pure((raw: ProbeInput) => Result.succeed(commandFor(raw))))
  .decide(resolveOutputMode)
  .encode(
    Sandwich.pure((
      outcome: Result.Result<ResolveModeDecision, ModeConflictError>,
    ): Result.Result<Result.Result<ResolvedMode, ModeConflictError>, never> =>
      Result.succeed(Result.map(outcome, decisionToResolvedMode))
    ),
  )
  .write((outcome) =>
    Result.match(outcome, {
      onFailure: (error) => Effect.fail(error),
      onSuccess: (mode) => Effect.succeed(mode),
    })
  )

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
>()('@systemfsoftware/stryker-js/output-mode-probe/OutputModeProbeTag') {}

const OutputModeProbe = OutputModeProbeTag

export { OutputModeProbe }

export const OutputModeProbeLive: Layer.Layer<
  OutputModeProbeTag,
  never,
  Stdio.Stdio
> = Layer.effect(
  OutputModeProbe,
  Effect.map(Stdio.Stdio, (stdio) =>
    OutputModeProbe.of({
      detectMode: Effect.provideService(
        detectModeWithProbe({}),
        Stdio.Stdio,
        stdio,
      ),
    })),
)
