export interface SnapshotTest {
  readonly id: string
  readonly file: string
  readonly name: string
}

export interface SnapshotTask {
  readonly id: string
  readonly name: string
  readonly fullTestName: string
  readonly file: { readonly filepath: string; readonly name: string }
  readonly type: 'test'
  readonly fails: boolean
}

let current: SnapshotTest | undefined

export const currentSnapshotTest = (): SnapshotTest | undefined => current

export const setSnapshotTest = (test: SnapshotTest | undefined): void => {
  current = test
}

export const snapshotTaskOf = (test: SnapshotTest): SnapshotTask => ({
  id: test.id,
  name: test.name,
  fullTestName: test.name,
  file: { filepath: test.file, name: test.file },
  type: 'test',
  fails: false,
})
