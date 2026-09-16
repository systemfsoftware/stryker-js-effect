import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CONTAINER_WORKROOT,
  ensureBed,
  readHostJson,
  requireStep,
  runCli,
  runShell,
  teardownBed,
} from './__fixtures__/bed.js'

const MACHINE_STREAM_FILE = 'reports/mutation-stream.jsonl'

const FRAMEWORK_MANIFEST_URL = new URL('../../../packages/stryker-js-engine/package.json', import.meta.url)

const frameworkVersion = async (): Promise<string> => {
  const manifest: unknown = await readHostJson(FRAMEWORK_MANIFEST_URL)
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(`${FRAMEWORK_MANIFEST_URL.pathname} is not an object manifest`)
  }
  const version: unknown = Reflect.get(manifest, 'version')
  if (typeof version !== 'string') {
    throw new Error(`${FRAMEWORK_MANIFEST_URL.pathname} declares no string version`)
  }
  return version
}

const streamEvents = async (cwd: string): Promise<ReadonlyArray<unknown>> => {
  const stream = await runShell(`cat ${MACHINE_STREAM_FILE}`, { cwd })
  if (stream.exitCode !== 0) {
    throw new Error(`the run wrote no ${MACHINE_STREAM_FILE}: ${stream.stderr.trim()}`)
  }
  return stream.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseEventLine)
}

const parseEventLine = (line: string): unknown => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object in ${MACHINE_STREAM_FILE}, received: ${line}`)
  }
  return value
}

const fieldOf = (event: unknown, field: string): unknown => {
  if (typeof event !== 'object' || event === null) {
    throw new Error(`no ${field} on a non-object event: ${JSON.stringify(event)}`)
  }
  return Reflect.get(event, field)
}

const firstEvent = (events: ReadonlyArray<unknown>): unknown => {
  const event = events.at(0)
  if (event === undefined) {
    throw new Error(`${MACHINE_STREAM_FILE} carries no events`)
  }
  return event
}

const lastEvent = (events: ReadonlyArray<unknown>): unknown => {
  const event = events.at(-1)
  if (event === undefined) {
    throw new Error(`${MACHINE_STREAM_FILE} carries no events`)
  }
  return event
}

const messageOfFailure = async (operation: Promise<unknown>): Promise<string> => {
  try {
    await operation
    return 'resolved without failing'
  } catch (cause) {
    if (cause instanceof Error) {
      return cause.message
    }
    return 'a failure that is not an Error'
  }
}

describe('the packed CLI a consumer installs', () => {
  beforeAll(ensureBed)
  afterAll(teardownBed)

  it('prints the framework version it inlines, as one help event on its machine stream, and exits 0', async () => {
    const expected = await frameworkVersion()

    const result = await runCli(['--version'])
    const events = await streamEvents(CONTAINER_WORKROOT)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const terminal = lastEvent(events)
    expect(fieldOf(terminal, 'kind')).toBe('help')
    expect(fieldOf(terminal, 'help')).toBe(expected)
    expect(fieldOf(terminal, 'code')).toBe(0)

    expect(fieldOf(firstEvent(events), 'kind')).toBe('stream')
    expect(fieldOf(firstEvent(events), 'mode')).toBe('machine')
  })

  it('puts a stryker bin shim on the PATH', async () => {
    const result = await runShell('command -v stryker')

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toMatch(/(?:^|\/)stryker$/)
  })

  it('names the failing step when a bed step fails', async () => {
    const failure = await messageOfFailure(
      requireStep('pack @systemfsoftware/stryker-js-cli', async () => {
        throw new Error('pnpm exited 1: ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND')
      }),
    )

    expect(failure).toMatch(/^pack @systemfsoftware\/stryker-js-cli: pnpm exited 1/)
  })
})
