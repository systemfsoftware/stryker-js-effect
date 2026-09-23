import { Sandbox, type SandboxHandle } from 'microsandbox'

import { ensureMicroVMEnvironment } from './microvm-environment.js'

const LANE_SANDBOX_NAME = /^effect-microsandbox-(\d+)-/u
const KILL_TIMEOUT_MS = 5_000

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return cause instanceof Error && 'code' in cause && cause.code === 'EPERM'
  }
}

const listSandboxes = async (): Promise<ReadonlyArray<SandboxHandle>> => {
  const handles: SandboxHandle[] = []
  let page = await Sandbox.list()
  handles.push(...page.sandboxes)
  while (page.nextCursor !== undefined) {
    const cursor = page.nextCursor
    page = await Sandbox.listWith((list) => list.cursor(cursor))
    handles.push(...page.sandboxes)
  }
  return handles
}

const ownerPidOf = (handle: SandboxHandle): number | undefined => {
  const owner = LANE_SANDBOX_NAME.exec(handle.name)?.[1]
  return owner === undefined ? undefined : Number(owner)
}

const removeSandbox = async (handle: SandboxHandle): Promise<void> => {
  await handle.killWithTimeout(KILL_TIMEOUT_MS).catch(() => undefined)
  await handle.destroy({ force: true })
}

const removeOrphanedSandboxes = async (): Promise<void> => {
  for (const handle of await listSandboxes()) {
    const owner = ownerPidOf(handle)
    if (owner === undefined || isAlive(owner)) {
      continue
    }
    await removeSandbox(handle).catch((cause: unknown) => {
      process.emitWarning(`cannot remove the orphaned lane sandbox ${handle.name}`, {
        code: 'STRYKER_E2E_ORPHAN_SANDBOX',
        detail: cause instanceof Error ? cause.message : String(cause),
      })
    })
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  await ensureMicroVMEnvironment()
  await removeOrphanedSandboxes()
  return removeOrphanedSandboxes
}
