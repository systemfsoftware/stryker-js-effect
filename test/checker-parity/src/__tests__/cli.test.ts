import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { parseArgs, type ParsedCommand, type ParsedCompare, refusalOutsideCi, type RunCommand } from '../run-side.js'

const RUN_TOKENS: ReadonlyArray<string> = [
  'run',
  '--main-worker',
  '/main/dist/main.mjs',
  '--branch-worker',
  '/branch/dist/main.mjs',
  '--main-source',
  '/main/src',
  '--branch-source',
  '/branch/src',
  '--shard',
  '3/6',
  '--cache',
  '.cache',
  '--out',
  'out',
]

const parsed = (tokens: ReadonlyArray<string>): ParsedCommand => Result.getOrThrow(parseArgs(tokens))

const failure = (tokens: ReadonlyArray<string>) => {
  const result = parseArgs(tokens)
  if (Result.isSuccess(result)) throw new Error('expected the parser to refuse these tokens')
  return result.failure
}

const runCommandOf = (command: ParsedCommand): RunCommand => {
  if (command._tag !== 'run') throw new Error('expected a run command')
  return command.command
}

const compareCommandOf = (command: ParsedCommand): ParsedCompare => {
  if (command._tag !== 'compare') throw new Error('expected a compare command')
  return command
}

describe('parseArgs', () => {
  it('reads a run command with the flags ci.yml passes', function*({ expect }) {
    const command = parsed(RUN_TOKENS)
    yield* expect(command).toStrictEqual({
      _tag: 'run',
      command: {
        mainWorker: '/main/dist/main.mjs',
        branchWorker: '/branch/dist/main.mjs',
        mainSource: '/main/src',
        branchSource: '/branch/src',
        shard: '3/6',
        cache: '.cache',
        out: 'out',
        allowLocal: false,
      },
    })
  })

  it('turns --allow-local into a boolean without eating the next token', function*({ expect }) {
    yield* expect(runCommandOf(parsed([...RUN_TOKENS, '--allow-local']))).toStrictEqual({
      mainWorker: '/main/dist/main.mjs',
      branchWorker: '/branch/dist/main.mjs',
      mainSource: '/main/src',
      branchSource: '/branch/src',
      shard: '3/6',
      cache: '.cache',
      out: 'out',
      allowLocal: true,
    })
  })

  it('reads a flag=value pair', function*({ expect }) {
    const command = parsed(RUN_TOKENS.map((token) => (token === '3/6' ? '--shard=3/6' : token)))
    yield* expect(runCommandOf(command).shard).toBe('3/6')
  })

  it('refuses a run missing a required flag', function*({ expect }) {
    const withoutOut = failure([...RUN_TOKENS.slice(0, RUN_TOKENS.indexOf('--out'))])
    yield* expect(withoutOut.code).toBe('usage-error')
  })

  it('reads a compare command with the flags ci.yml passes', function*({ expect }) {
    const command = parsed(['compare', '--shards', '6', '--summary', 'summary.json', 'shards'])
    yield* expect(command).toStrictEqual({
      _tag: 'compare',
      shards: 6,
      summary: 'summary.json',
      gates: { shortcutCount: false, speed: false },
      dirs: ['shards'],
    })
  })

  it('turns the gate flags on', function*({ expect }) {
    const command = parsed(['compare', '--shards', '6', '--summary', 's.json', '--shortcut-gate', '--speed-gate', 'd'])
    yield* expect(compareCommandOf(command).gates).toStrictEqual({ shortcutCount: true, speed: true })
  })

  it.each(['0', 'two'])('refuses --shards %s', function*(shards, { expect }) {
    yield* expect(failure(['compare', '--shards', shards, '--summary', 's.json', 'd']).code).toBe('usage-error')
  })

  it('refuses a compare with no directories', function*({ expect }) {
    yield* expect(failure(['compare', '--shards', '6', '--summary', 's.json']).code).toBe('usage-error')
  })

  it('refuses an unknown command', function*({ expect }) {
    yield* expect(failure(['frobnicate']).code).toBe('usage-error')
  })
})

describe('refusalOutsideCi', () => {
  const runCommand = parsed([...RUN_TOKENS])

  it.each([{}, { CI: '' }])(
    'refuses a run outside CI when --allow-local was not passed (env %j)',
    function*(env, { expect }) {
      yield* expect(refusalOutsideCi(runCommand, env)?.code).toBe('refused-outside-ci')
    },
  )

  it('lets a run through in CI', function*({ expect }) {
    yield* expect(refusalOutsideCi(runCommand, { CI: 'true' })).toBe(undefined)
  })

  it('lets a run through when --allow-local was passed', function*({ expect }) {
    const allowed = parsed([...RUN_TOKENS, '--allow-local'])
    yield* expect(refusalOutsideCi(allowed, {})).toBe(undefined)
  })

  it('never refuses a compare, which reads only files it was handed', function*({ expect }) {
    const compareCommand = parsed(['compare', '--shards', '6', '--summary', 's.json', 'd'])
    yield* expect(refusalOutsideCi(compareCommand, {})).toBe(undefined)
  })
})
