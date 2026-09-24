export { harnessSourceFor, harnessUrlForSpecifier } from '../harness-sources.handle.js'
export { nativeImport } from '../native-import.handle.js'
export {
  activateSandbox,
  deactivateSandbox,
  installInterception,
  uninstallInterception,
} from '../sandbox-interception.handle.js'
export { readGlobalState, writeGlobalState } from '../sandbox-state.handle.js'
export type { HarnessModuleBuiltin, VmRunnerGlobalState } from '../sandbox.schema.js'
