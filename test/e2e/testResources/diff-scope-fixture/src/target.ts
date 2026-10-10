type BiOperator = (a: number, b: number) => number
// @stryker-expect next-line Killed: ArrowFunction, ArithmeticOperator
export const target: BiOperator = (a, b) => a + b
