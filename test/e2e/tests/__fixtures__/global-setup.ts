import { ensureContainerEnvironment } from './container-environment.js'

export default async function setup(): Promise<void> {
  await ensureContainerEnvironment()
}
