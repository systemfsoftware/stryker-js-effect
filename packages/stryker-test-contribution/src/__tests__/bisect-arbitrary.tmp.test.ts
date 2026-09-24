import { describe, expect, it } from 'vitest'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { TestContributionDecision } from '../judge-test-contribution.workflow.js'

describe('bisect', () => {
  it('decision-union', () => {
    const A = Arbitrary.schema(TestContributionDecision)
    expect(typeof A).toBe('object')
  })
})
