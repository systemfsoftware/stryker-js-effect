// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const accrue = (steps: number): number => {
  let n = 0
  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression, EqualityOperator
  // @stryker-expect next-line Timeout: UpdateOperator
  // @stryker-expect next-line Killed: BlockStatement
  for (let i = 0; i < steps; i++) {
    n += 1
  }
  return n
}

// @stryker-expect file KilledOrTimeout: all
