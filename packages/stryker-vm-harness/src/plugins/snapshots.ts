import type { VmSessionPlugin } from '../session-plugin.js'
import {
  createSnapshotSupport,
  setSnapshotDrainWindow,
  setSnapshotRegistry,
  type SnapshotSupport,
} from '../snapshots/index.js'

let support: SnapshotSupport | undefined

export const snapshotsPlugin: VmSessionPlugin = {
  name: 'snapshots',
  init(host) {
    return createSnapshotSupport(host).then((built) => {
      support = built
    })
  },
  beforeGraphLoad(graph) {
    setSnapshotRegistry(graph.registry)
  },
  beforeFileImport() {
    setSnapshotDrainWindow(undefined)
  },
  beforeFileRun(file) {
    setSnapshotDrainWindow(file.file)
    return support?.openFile(file.file)
  },
  beforeTest(test) {
    setSnapshotDrainWindow(test.file)
    support?.beginTest({ id: test.id, file: test.file, name: test.name }, test.runKind)
  },
  afterTest() {
    support?.endTest()
  },
  afterFileRun(file) {
    const closed = support?.closeFile(file.file)
    setSnapshotDrainWindow(undefined)
    return closed
  },
}
