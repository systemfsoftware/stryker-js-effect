const DOMINATOR_REPLACEMENT = 'a <= b'

export const dominatorAnswerOf = (dominatorAnswer) => (mutant) =>
  mutant.replacement === DOMINATOR_REPLACEMENT ? dominatorAnswer : { status: 'passed' }
