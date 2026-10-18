export const TURBO_PROGRAM = new URL('../node_modules/.bin/turbo', import.meta.url).pathname

export const PERMITTED_SCRATCH_DIR = '/tmp'

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const cleanEnv = (overrides: Readonly<Record<string, string>> = {}): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (key.startsWith('GITHUB_') || key.startsWith('TURBO_')) continue
    env[key] = value
  }
  env.GIT_AUTHOR_NAME = 'probe'
  env.GIT_AUTHOR_EMAIL = 'probe@example.com'
  env.GIT_COMMITTER_NAME = 'probe'
  env.GIT_COMMITTER_EMAIL = 'probe@example.com'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_SYSTEM = '/dev/null'
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...overrides }
}

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export const run = async (
  program: string,
  args: ReadonlyArray<string>,
  cwd: string | URL,
  env: Readonly<Record<string, string>> = cleanEnv(),
): Promise<Ran> => {
  const output = await new Deno.Command(program, { args: [...args], cwd, env, clearEnv: true }).output()
  return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) }
}

export const git = async (dir: string, args: ReadonlyArray<string>): Promise<Ran> => {
  const ran = await run('git', args, dir)
  if (ran.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr}`)
  return ran
}

const head = async (dir: string): Promise<string> => (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()

export const commit = async (
  dir: string,
  message: string,
  options: { readonly allowEmpty?: boolean } = {},
): Promise<string> => {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', ...(options.allowEmpty === true ? ['--allow-empty'] : []), '-m', message])
  return await head(dir)
}

export const write = async (dir: string, relative: string, content: string): Promise<void> => {
  const path = `${dir}/${relative}`
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}
