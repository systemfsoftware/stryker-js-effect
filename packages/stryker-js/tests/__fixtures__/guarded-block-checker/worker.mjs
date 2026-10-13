import { serveChecker } from '../checker-worker.mjs'

const REJECTED_MUTATORS = ['BlockStatement', 'ArithmeticOperator']
const REJECTION_REASON = 'rejected by the guarded-block fixture checker'

const answerOf = (mutant) =>
  REJECTED_MUTATORS.includes(mutant.mutatorName)
    ? { status: 'compileError', reason: REJECTION_REASON }
    : { status: 'passed' }

serveChecker(answerOf)
