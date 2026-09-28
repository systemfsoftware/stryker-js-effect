// Annotation outcomes below are authored from each construct's intent, never read from a run.

// @stryker-expect next-line Killed: BlockStatement
export function add(a: number, b: number): number {
  // @stryker-expect next-line Killed: ArithmeticOperator
  return a + b
}

// @stryker-expect next-line Killed: BlockStatement
export function isPositive(n: number): boolean {
  // @stryker-expect next-line Killed: ConditionalExpression, EqualityOperator
  return n > 0
}

// @stryker-expect next-line Survived: BlockStatement
export function double(n: number): number {
  // @stryker-expect next-line Survived: ArithmeticOperator
  return n * 2
}

// @stryker-expect next-line NoCoverage: BlockStatement
export function never(n: number): number {
  // @stryker-expect next-line NoCoverage: ArithmeticOperator
  return n + 1
}
