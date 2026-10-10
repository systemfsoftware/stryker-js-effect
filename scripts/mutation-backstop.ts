#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
import { parseArgs } from '@std/cli/parse-args'
import { join, resolve } from '@std/path'

const DEFAULT_PACKAGE = 'packages/stryker-js'
const DEFAULT_CLI = 'packages/stryker-js/dist/main.mjs'
const FIRST_REPORT = 'run-1.mutation.json'
const SECOND_REPORT = 'run-2.mutation.json'
const CACHED_REPORT = 'cached.mutation.json'
const FIRST_INCREMENTAL = 'run-1.stryker-incremental.json'
const SECOND_INCREMENTAL = 'run-2.stryker-incremental.json'
const NOISE_FILE = 'noise.json'
const MUTATION_REPORT = 'reports/mutation-report.json'
const ABSENT = 'absent'

export type StatusTable = Readonly<Record<string, string>>

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

export const statusesOf = (report: unknown, source: string): StatusTable => {
  const files = recordOf(recordOf(report, source)['files'], `${source}: files`)
  const statuses: Record<string, string> = {}
  for (const [fileName, file] of Object.entries(files)) {
    const mutants = recordOf(file, `${source}: files["${fileName}"]`)['mutants']
    if (!Array.isArray(mutants)) {
      throw new Error(`${source}: files["${fileName}"].mutants must be an array`)
    }
    for (const mutant of mutants) {
      const entry = recordOf(mutant, `${source}: a mutant of ${fileName}`)
      const { id, status } = entry
      if (typeof id !== 'string' || typeof status !== 'string') {
        throw new Error(`${source}: a mutant of ${fileName} has no string id and status`)
      }
      statuses[id] = status
    }
  }
  return statuses
}

export const disagreementsOf = (left: StatusTable, right: StatusTable): readonly string[] =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((id) => (left[id] ?? ABSENT) !== (right[id] ?? ABSENT))
    .sort()

const readJson = async (path: string): Promise<unknown> => {
  const text = await Deno.readTextFile(path)
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`${path} is not JSON: ${reason(cause)}`)
  }
}

const statusesOfFile = async (path: string): Promise<StatusTable> => statusesOf(await readJson(path), path)

const exists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path)
    return true
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return false
    throw cause
  }
}

const runStryker = async (cli: string, cwd: string, cliArgs: readonly string[]): Promise<number> => {
  const command = new Deno.Command(cli, { args: [...cliArgs], cwd, stdout: 'inherit', stderr: 'inherit' })
  const { code } = await command.output()
  return code
}

const runCold = async (
  cli: string,
  packageDir: string,
  label: string,
  incrementalFile: string,
  reportFile: string,
): Promise<void> => {
  const code = await runStryker(cli, packageDir, ['run', '--force', '--incrementalFile', incrementalFile])
  const produced = join(packageDir, MUTATION_REPORT)
  if (!await exists(produced)) {
    throw new Error(`${label} exited ${code} without writing ${produced}; a cold run must finish`)
  }
  await Deno.copyFile(produced, reportFile)
  console.log(`${label}: exit ${code}, per-mutant statuses preserved at ${reportFile}`)
}

const main = async (): Promise<number> => {
  const args = parseArgs(Deno.args, { string: ['package', 'runs', 'cache', 'cli'] })
  const packageDir = resolve(args.package ?? DEFAULT_PACKAGE)
  const runsDir = resolve(args.runs ?? join(packageDir, 'reports', 'backstop'))
  const cacheFile = resolve(args.cache ?? join(packageDir, MUTATION_REPORT))
  const cli = resolve(args.cli ?? DEFAULT_CLI)

  if (!await exists(cli)) throw new Error(`no workspace CLI at ${cli}; build it with \`pnpm build\` first`)
  if (!await exists(cacheFile)) {
    throw new Error(`no cached mutation report at ${cacheFile}; run the dogfood suite first`)
  }

  await Deno.mkdir(runsDir, { recursive: true })
  const cached = join(runsDir, CACHED_REPORT)
  const first = join(runsDir, FIRST_REPORT)
  const second = join(runsDir, SECOND_REPORT)
  const noiseFile = join(runsDir, NOISE_FILE)

  await Deno.copyFile(cacheFile, cached)

  await runCold(cli, packageDir, 'cold run 1', join(runsDir, FIRST_INCREMENTAL), first)
  await runCold(cli, packageDir, 'cold run 2', join(runsDir, SECOND_INCREMENTAL), second)

  const noise = disagreementsOf(await statusesOfFile(first), await statusesOfFile(second))
  await Deno.writeTextFile(noiseFile, `${JSON.stringify(noise, null, 2)}\n`)
  console.log(`noise: ${noise.length} mutant(s) disagree between the two cold runs -> ${noiseFile}`)

  const code = await runStryker(cli, packageDir, [
    'compare',
    '--baseline',
    cached,
    '--fresh',
    first,
    '--noise',
    noiseFile,
  ])
  console.log(`backstop: cached statuses versus cold run 1 exited ${code}`)
  return code
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`mutation-backstop: error: ${reason(error)}`)
    Deno.exit(1)
  }
}
