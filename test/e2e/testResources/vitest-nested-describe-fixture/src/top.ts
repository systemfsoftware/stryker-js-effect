// Annotation outcomes below are authored from each construct's intent, never read from a run.

// @stryker-expect next-line Killed: BlockStatement
export function farewell(): string {
  // @stryker-expect next-line Killed: StringLiteral
  return 'bye'
}
