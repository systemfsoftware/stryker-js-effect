// Annotation outcomes below are authored from each construct's intent, never read from a run.

// @stryker-expect next-line Killed: BlockStatement
export function add(a: number, b: number): number {
  // @stryker-expect next-line Killed: ArithmeticOperator
  return a + b
}

// @stryker-expect next-line Killed: BlockStatement
export function isPositive(n: number): boolean {
  // @stryker-expect next-line Killed: ConditionalExpression, EqualityOperator="n >= 0"
  // @stryker-expect next-line Ignored: EqualityOperator="n <= 0"
  return n > 0
}

// @stryker-expect next-line Survived: BlockStatement
export function double(n: number): number {
  // @stryker-expect next-line Survived: ArithmeticOperator
  return n * 2
}
