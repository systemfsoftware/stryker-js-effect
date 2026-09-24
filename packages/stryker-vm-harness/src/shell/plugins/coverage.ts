import type { VmSessionPlugin } from '../session-plugin.js'
import { hostStrykerNamespace, setCurrentTestId } from '../stryker-namespace.js'

export const coveragePlugin: VmSessionPlugin = {
  name: 'coverage',
  beforeTest: (test) => {
    if (test.runKind !== 'dry') {
      return
    }
    setCurrentTestId(hostStrykerNamespace(), test.id)
  },
  afterTest: () => {
    setCurrentTestId(hostStrykerNamespace(), undefined)
  },
}
