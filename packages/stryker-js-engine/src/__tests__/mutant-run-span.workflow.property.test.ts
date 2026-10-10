import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as S from 'effect/Schema'

import { spanRunStatusOf } from '../mutant-run-span.js'

const declaredRunStatus = SpanTaxonomy.Spans.testRunnerMutantRun.attributes['test.suite.run.status']

const ktd19Rows = {
  killed: 'failure',
  survived: 'success',
  timeout: 'timed_out',
  error: 'aborted',
} as const

describe('spanRunStatusOf', () => {
  it.prop(
    '∀r_MutantRunResult_≡TheRunStatusIsTheDeclaredKtd19Status',
    { of: [TestRunner.MutantRunResultSchema], subject: spanRunStatusOf },
    (subject, [result]) =>
      S.is(declaredRunStatus)(subject(result.status)) &&
      subject('killed') === ktd19Rows.killed &&
      subject('survived') === ktd19Rows.survived &&
      subject('timeout') === ktd19Rows.timeout &&
      subject('error') === ktd19Rows.error,
  )
})
