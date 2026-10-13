import { serveChecker } from '../checker-worker.mjs'
import { dominatorAnswerOf } from './dominator-answer.mjs'

serveChecker(dominatorAnswerOf({ status: 'ignored', reason: 'checker: ignored by the subsumption fixture checker' }))
