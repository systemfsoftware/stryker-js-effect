import type { VmSessionPlugin } from '../session-plugin.js'
import { coveragePlugin } from './coverage.js'
import { definePlugin } from './define.js'
import { environmentPlugin } from './environment.js'
import { createGlobalScopePlugin } from './global-scope.js'
import { createGlobalSetupPlugin } from './global-setup.js'
import { globalsPlugin } from './globals.js'
import { createMockingPlugin } from './mocking.js'
import { runnerStatePlugin } from './runner-state.js'
import { setupFilesPlugin } from './setup-files.js'
import { snapshotsPlugin } from './snapshots.js'
import { tagsPlugin } from './tags.js'
import { transformPlugin } from './transform.js'
import { vitestConfigPlugin } from './vitest-config.js'

export const builtinPlugins: readonly VmSessionPlugin[] = [
  vitestConfigPlugin,
  createGlobalSetupPlugin(),
  createGlobalScopePlugin(),
  definePlugin,
  environmentPlugin,
  globalsPlugin,
  setupFilesPlugin,
  tagsPlugin,
  createMockingPlugin(),
  transformPlugin,
  snapshotsPlugin,
  coveragePlugin,
  runnerStatePlugin,
]
