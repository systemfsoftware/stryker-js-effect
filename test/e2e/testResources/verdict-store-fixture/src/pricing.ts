// Annotation outcomes below are authored from each construct's intent and the fixture's tests, never read from a run.

// @stryker-expect next-line Killed: BlockStatement
export function subtotal(prices: readonly number[]): number {
  // @stryker-expect next-line Killed: ArrowFunction, ArithmeticOperator
  return prices.reduce((total, price) => total + price, 0)
}

// @stryker-expect next-line Killed: BlockStatement
export function discounted(price: number, percent: number): number {
  // @stryker-expect next-line Killed: ArithmeticOperator
  return price - (price * percent) / 100
}

// @stryker-expect next-line Killed: BlockStatement
export function withTax(price: number, rate: number): number {
  // @stryker-expect next-line Killed: ArithmeticOperator
  return price + price * rate
}

// @stryker-expect next-line Killed: BlockStatement
export function isFree(price: number): boolean {
  // @stryker-expect next-line Killed: ConditionalExpression, EqualityOperator
  return price <= 0
}

// @stryker-expect next-line Killed: BlockStatement
export function isBulk(quantity: number): boolean {
  // @stryker-expect next-line Killed: ConditionalExpression, EqualityOperator
  return quantity >= 10
}

// @stryker-expect next-line Killed: BlockStatement
export function shippingFor(weight: number): number {
  // @stryker-expect next-line Ignored: ConditionalExpression="true"
  // @stryker-expect next-line Killed: ConditionalExpression="false"
  // @stryker-expect next-line Ignored: EqualityOperator="weight <= 20"
  // @stryker-expect next-line Survived: EqualityOperator="weight >= 20"
  // @stryker-expect next-line Killed: EqualityOperator="weight != 20"
  // @stryker-expect next-line Killed: BlockStatement
  if (weight > 20) {
    return 15
  }
  // @stryker-expect next-line Ignored: ConditionalExpression="true"
  // @stryker-expect next-line Killed: ConditionalExpression="false"
  // @stryker-expect next-line Ignored: EqualityOperator="weight <= 5"
  // @stryker-expect next-line Survived: EqualityOperator="weight >= 5"
  // @stryker-expect next-line Killed: EqualityOperator="weight != 5"
  // @stryker-expect next-line Killed: BlockStatement
  if (weight > 5) {
    return 8
  }
  return 3
}

// @stryker-expect next-line Killed: BlockStatement
export function label(price: number): string {
  // @stryker-expect next-line Ignored: ConditionalExpression="true"
  // @stryker-expect next-line Survived: ConditionalExpression="false"
  // @stryker-expect next-line Ignored: EqualityOperator="price <= 100"
  // @stryker-expect next-line Survived: EqualityOperator="price >= 100"
  // @stryker-expect next-line Survived: EqualityOperator="price != 100"
  // @stryker-expect next-line Survived: StringLiteral
  return price > 100 ? 'premium' : 'standard'
}

// @stryker-expect next-line Killed: BlockStatement
export function clamp(value: number, low: number, high: number): number {
  // @stryker-expect next-line Killed: MethodExpression
  return Math.min(Math.max(value, low), high)
}
