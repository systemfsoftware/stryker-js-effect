import { it } from '@systemfsoftware/vitest'

it('carries a planted type error for the CI verdict', () => {
  const planted: number = 'not a number'
  void planted
})
