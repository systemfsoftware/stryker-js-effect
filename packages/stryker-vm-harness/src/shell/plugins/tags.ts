import type { TestRegistry } from '../../core/registry.js'
import { validateTagsForFile } from '../../core/registry.js'
import { projectForFile } from '../environments/file-config.js'
import type { VmGraphContext, VmSessionPlugin } from '../session-plugin.js'

const TAGS_PLUGIN_NAME = 'tags'

const registries = new WeakMap<object, TestRegistry>()

export const tagsPlugin: VmSessionPlugin = {
  name: TAGS_PLUGIN_NAME,
  beforeGraphLoad: (graph: VmGraphContext, host) => {
    registries.set(host, graph.registry)
  },
  disposeGraph: (_graph: VmGraphContext, host) => {
    registries.delete(host)
  },
  afterFileImport: (file, host) => {
    const registry = registries.get(host)
    if (registry === undefined) {
      return
    }
    validateTagsForFile(registry, file.file, projectForFile(host, file.file))
  },
}
