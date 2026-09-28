// Annotation outcomes below are authored from each construct's intent, never read from a run.

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function add(left: number, right: number): number {
  // @stryker-expect next-line KilledOrTimeout: ArithmeticOperator
  return left + right
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function accumulate(steps: number): number {
  let total = 0
  // @stryker-expect next-line KilledOrTimeout: AssignmentOperator
  total += steps
  // @stryker-expect next-line Ignored: UpdateOperator
  total++
  return total
}

// @stryker-expect next-line Ignored: BlockStatement
function negate(value: number): number {
  // Stryker disable next-line UnaryOperator
  // @stryker-expect next-line Ignored: UnaryOperator
  return -value
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function isEqual(left: number, right: number): boolean {
  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression, EqualityOperator
  return left === right
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function both(flag: boolean, other: boolean): boolean {
  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression, LogicalOperator
  return flag && other
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function lower(text: string): string {
  // @stryker-expect next-line KilledOrTimeout: MethodExpression
  return text.toLowerCase()
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function label(): string {
  // @stryker-expect next-line KilledOrTimeout: StringLiteral, acme/FlipSide
  return 'left'
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function greet(): string {
  // @stryker-expect next-line KilledOrTimeout: StringLiteral
  const name = 'hello'
  return name
}

interface Box {
  readonly size: number
}

// @stryker-expect next-line CompileError(TS2741): ObjectLiteral
const box: Box = { size: 42 }

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function sizeOf(candidate: Box | undefined): number | undefined {
  // @stryker-expect next-line KilledOrTimeout: OptionalChaining
  return candidate?.size
}

// @stryker-expect next-line KilledOrTimeout: BlockStatement
function classify(flag: boolean, yes: string, no: string): string {
  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression
  if (flag) return yes
  return no
}

// @stryker-expect next-line KilledOrTimeout: Regex
const matcher = /a+/

// @stryker-expect next-line KilledOrTimeout: ArrayDeclaration
const values = [1, 2]

// @stryker-expect next-line KilledOrTimeout: ArrowFunction, ArithmeticOperator
const double = (value: number): number => value * 2

// @stryker-expect next-line KilledOrTimeout: BooleanLiteral
const enabled = true

// @stryker-expect next-line KilledOrTimeout: ObjectLiteral
const sample = { double, enabled, matcher, values }

export type AnnotatedSampleDeclarations =
  | typeof accumulate
  | typeof add
  | typeof both
  | typeof box
  | typeof classify
  | typeof greet
  | typeof isEqual
  | typeof label
  | typeof lower
  | typeof negate
  | typeof sample
  | typeof sizeOf
