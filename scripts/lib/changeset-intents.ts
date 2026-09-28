export type Bump = 'none' | 'patch' | 'minor' | 'major'

export type ChangeIntent = {
  readonly package: string
  readonly bump: Bump
}

const BUMPS: ReadonlySet<string> = new Set(['none', 'patch', 'minor', 'major'])

export const parseChangesetIntents = (markdown: string): readonly ChangeIntent[] => {
  const intents: ChangeIntent[] = []
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return intents
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return intents
  for (const line of lines.slice(1, end)) {
    const match = /^\s*"?([^"]+?)"?\s*:\s*(\S+)\s*$/.exec(line)
    if (!match) continue
    const [, name, bump] = match
    if (name !== undefined && bump !== undefined && BUMPS.has(bump)) {
      intents.push({ package: name, bump: bump as Bump })
    }
  }
  return intents
}

export const collectChangesetIntents = async (changesetDir: string): Promise<readonly ChangeIntent[]> => {
  const intents: ChangeIntent[] = []
  const files: string[] = []
  try {
    for await (const entry of Deno.readDir(changesetDir)) {
      if (entry.isFile && entry.name.endsWith('.md') && entry.name !== 'README.md') files.push(entry.name)
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return intents
    throw error
  }
  for (const file of files.sort()) {
    intents.push(...parseChangesetIntents(await Deno.readTextFile(`${changesetDir}/${file}`)))
  }
  return intents
}
