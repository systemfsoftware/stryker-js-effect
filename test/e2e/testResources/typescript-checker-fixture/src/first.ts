// @stryker-expect file CompileError(TS2322): LogicalOperator
// @stryker-expect file Killed: ArrowFunction, StringLiteral
export const firstOr = (values: ReadonlyArray<string>): string => values[0] ?? 'none'
