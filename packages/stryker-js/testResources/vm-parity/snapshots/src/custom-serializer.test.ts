import { expect, test } from 'vitest'

import { widget } from './summary'

const isWidget = (value: unknown): value is { readonly kind: string } =>
  typeof value === 'object' && value !== null && 'kind' in value

expect.addSnapshotSerializer({
  test: isWidget,
  print: (value) => `Widget(${isWidget(value) ? value.kind : String(value)})`,
})

test('uses the registered serializer in snapshots', () => {
  expect(widget('gear', 4)).toMatchSnapshot()
})
