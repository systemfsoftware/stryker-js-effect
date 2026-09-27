// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

// @stryker-expect next-line Survived: BlockStatement="{}"
export const reportDeferredFailure = (failed: boolean): void => {
  // @stryker-expect next-line Survived: BlockStatement="{}"
  queueMicrotask(() => {
    // @stryker-expect next-line RuntimeError(TypeError): ConditionalExpression="true"
    // @stryker-expect next-line Survived: ConditionalExpression="false"
    // @stryker-expect next-line NoCoverage: BlockStatement="{}"
    if (failed) {
      throw new TypeError()
    }
  })
}
