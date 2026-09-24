import { describe, expect, it } from 'vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { JudgeTestContribution } from '../judge-test-contribution.workflow.js'

describe('bisect-cmd', () => {
  it('derives', () => {
    expect(() => Arbitrary.schema(JudgeTestContribution as never)).not.toThrow()
  })
})
