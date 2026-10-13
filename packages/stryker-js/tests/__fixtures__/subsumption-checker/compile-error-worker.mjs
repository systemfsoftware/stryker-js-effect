import { serveChecker } from '../checker-worker.mjs'
import { dominatorAnswerOf } from './dominator-answer.mjs'

serveChecker(
  dominatorAnswerOf({ status: 'compileError', reason: 'the subsumption fixture checker refused the dominator' }),
)
