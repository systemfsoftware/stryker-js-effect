import { it } from '@systemfsoftware/vitest'

import { Alpha } from './pair.schema.js'

it('declares a count field', function*({ expect }) {
  yield* expect(Object.keys(Alpha.fields)).toEqual(['count'])
})
