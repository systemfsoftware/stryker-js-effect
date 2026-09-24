import { projectForFile } from '../environments/file-config.js'
import type { VmFileContext, VmPluginHost, VmSessionPlugin } from '../session-plugin.js'

const PLUGIN_NAME = 'setup-files'

const importSetupFiles = (host: VmPluginHost, file: VmFileContext): Promise<void> =>
  projectForFile(host, file.file).setupFiles.reduce(
    (chained, setupFile) => chained.then(() => host.importFile(setupFile, file.salt)),
    Promise.resolve(),
  )

export const setupFilesPlugin: VmSessionPlugin = {
  name: PLUGIN_NAME,
  beforeFileImport: (file, host) => importSetupFiles(host, file),
}
