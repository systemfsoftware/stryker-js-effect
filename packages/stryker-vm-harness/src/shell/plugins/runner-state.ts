import {
  installWorkerState,
  readGlobalState,
  setWorkerTestPath,
  withRunnerTask,
  writeGlobalState,
} from '../global-state.js'
import type { VmSessionPlugin } from '../session-plugin.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'

const workerTaskReader = (): object | undefined => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__') as
    | { current?: object | undefined }
    | undefined
  return workerState?.current
}

export const runnerStatePlugin: VmSessionPlugin = {
  name: 'runner-state',
  beforeFileImport: (file, host) => {
    const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    const project = runtime?.projectFor(file.file)
    installWorkerState({
      config: project,
      filepath: file.file,
      environmentName: project?.environment ?? 'node',
      vitestIndex: host.resolveVitest(),
    })
    setWorkerTestPath(file.file)
    const state = readGlobalState()
    if (state !== undefined) {
      writeGlobalState({
        ...state,
        projectConfig: project,
        expect: state.expect === undefined ? undefined : withRunnerTask(state.expect, workerTaskReader),
      })
    }
  },
  beforeTest: (test) => {
    setWorkerTestPath(test.file)
  },
  beforeFileRun: (file, host) => {
    const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    const project = runtime?.projectFor(file.file)
    installWorkerState({
      config: project,
      filepath: file.file,
      environmentName: project?.environment ?? 'node',
      vitestIndex: host.resolveVitest(),
    })
    setWorkerTestPath(file.file)
  },
}
