import * as Option from 'effect/Option'

import {
  installWorkerState,
  readGlobalState,
  setWorkerTestPath,
  withRunnerTask,
  workerStateOf,
  writeGlobalState,
} from '../sandbox-state.handle.js'
import type { VmFileContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'
import type { VmProjectConfig } from '../vitest-config.schema.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from '../vitest-host/runtime.js'

const workerTaskReader = (): object | undefined => workerStateOf()?.current

const projectOf = (file: VmFileContext, host: VmPluginHost): VmProjectConfig | undefined =>
  host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)?.projectFor(file.file)

const environmentNameOf = (project: VmProjectConfig | undefined): string =>
  Option.getOrElse(Option.fromNullishOr(project?.environment), () => 'node')

const installForFile = (file: VmFileContext, host: VmPluginHost): VmProjectConfig | undefined => {
  const project = projectOf(file, host)
  installWorkerState({
    config: project,
    filepath: file.file,
    environmentName: environmentNameOf(project),
    vitestIndex: host.resolveVitest(),
  })
  setWorkerTestPath(file.file)
  return project
}

const expectOf = (expect: object | undefined): object | undefined =>
  expect === undefined ? undefined : withRunnerTask(expect, workerTaskReader)

const refreshGlobalState = (project: VmProjectConfig | undefined): void => {
  const state = readGlobalState()
  if (state !== undefined) {
    writeGlobalState({ ...state, projectConfig: project, expect: expectOf(state.expect) })
  }
}

export const runnerStatePlugin: VmSessionPlugin = {
  name: 'runner-state',
  beforeFileImport: (file, host) => {
    refreshGlobalState(installForFile(file, host))
  },
  beforeTest: (test) => {
    setWorkerTestPath(test.file)
  },
  beforeFileRun: (file, host) => {
    installForFile(file, host)
  },
}
