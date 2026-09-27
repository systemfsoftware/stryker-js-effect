// Annotation outcomes below are authored from each construct's intent, never read from a run.

// @stryker-expect file Killed: ArrowFunction
// @stryker-expect file Killed: BooleanLiteral
// @stryker-expect next-line Survived: ArithmeticOperator
export const incrementBy = (value: number, step: number): number => value + step

export const toggleValue = (value: boolean): boolean => !value
