# Mutator Semantics Contract

This document is the human authority specifying the placement and replacement rules for all 16 mutator families registered in `allMutators` (`packages/stryker-js-instrumenter/src/Mutator.ts`).
Each family defines exact AST matching criteria, explicit exclusions, emitted replacements, and visitor code citations.

---

## Gray Zone Specifications & Architectural Invariants

### 1. OptionalChaining (`?.`, `?.[`, `?.(`) and Interplay with Prefix `!`

- **Visitor arms:** `optionalChainingMutator` in `Mutator.ts:1087-1106` (`isOptionalMember`, `isOptionalCall`).
- **Placement:** Matches `MemberExpression` where `node.optional === true` and `CallExpression` where `node.optional === true`.
  - Static member: `a?.b` -> `a.b` (replaces optional access with standard property access).
  - Computed element member: `a?.[k]` -> `a[k]` (replaces optional element access with indexed access).
  - Optional call: `a?.()` -> `a()` (replaces optional call with standard call invocation).
- **Interplay with prefix `!`:** On an expression like `!a?.b`:
  - `a?.b` is a `MemberExpression` with `optional: true`. `optionalChainingMutator` places one mutant replacing it with `a.b`.
  - `!a?.b` is a `UnaryExpression` with `operator: '!'` and `prefix: true`. `booleanLiteralMutator` (`isNegatedPrefix`) places one mutant collapsing it to `a?.b`.
  - Both mutants are placed independently at their distinct AST nodes without conflict or double-counting.

### 2. Decorator-Skipping Behavior

- **Visitor arms:** `Transformer.ts:1161` (`nodeType(path.node) === 'Decorator'`) inside `shouldSkip(path)`.
- **Placement:** During AST traversal in `Transformer.ts:1092-1095`, any node of type `Decorator` causes `path.skip()`:
  - The `@decorator(...)` node itself is never mutated.
  - Traversal does not descend into decorator arguments or expressions (e.g. `@decorator(1 + 2, "str")` produces zero arithmetic or string mutants).
  - Decorators on classes, methods, accessors, or properties produce zero mutants.

### 3. Prefix-`!` Collapse Owned by BooleanLiteral

- **Visitor arms:** `booleanLiteralMutator` in `Mutator.ts:758-781` (`isNegatedPrefix`).
- **Placement:** Matches `UnaryExpression` where `operator === '!'` and `prefix === true`.
- **Replacement:** Emits the operand directly (`cloneNode(unary.argument)`), collapsing `!x` -> `x`.
- **Authority boundary:** Prefix `!` is strictly owned by `BooleanLiteral` and is never matched by `UnaryOperator`.

### 4. UnaryOperator (`+`, `-`, `~`)

- **Visitor arms:** `unaryOperatorMutator` in `Mutator.ts:1269-1304` (`isSupportedUnaryExpression`, `unaryOperatorReplacement`).
- **Placement:** Matches `UnaryExpression` with `prefix: true` and operator in `['+', '-', '~']`.
- **Replacement:**
  - `+x` -> `-x`
  - `-x` -> `+x`
  - `~x` -> `x` (bitwise NOT operator is stripped).
- **Exclusions:** Does not match `!`, `typeof`, `void`, or `delete`.

### 5. MethodExpression Member-Call Replacement

- **Visitor arms:** `methodExpressionMutator` in `Mutator.ts:956-1075` (`isCallExpression`, `namedMethodCallee`, `isNamedMember`, `isNotSuperMember`).
- **Placement:** Matches `CallExpression` where `callee` is a `MemberExpression` whose property is an identifier matching the replacement table, and whose object is not `super`.
- **Replacement rules:**
  - **Direct object invocation (removal):** For methods mapped to `null` (`filter`, `slice`, `sort`, `trim`, `charAt`, `substr`, `substring`), the call is replaced by invoking the callee object directly: `callExpression(cloneNode(callee.object), [], callee.optional === true)`. Example: `arr.filter(predicate)` -> `arr()`.
  - **Inverted method invocation:** For methods mapped to an opposite name (`every` <-> `some`, `toLowerCase` <-> `toUpperCase`, `endsWith` <-> `startsWith`, `min` <-> `max`, etc.), the call is replaced by invoking the opposite method with spread-free arguments preserved: `callExpression(memberExpression(object, identifier(newName), optional), spreadFreeArgs, callOptional)`. Example: `arr.every(fn)` -> `arr.some(fn)`.
- **Exclusions:**
  - Calls where the callee object is `super` (e.g. `super.filter(...)`).
  - Calls where the method name is not in the replacement map.
  - Computed method calls (e.g. `arr[methodName]()`).

### 6. Regex Mutation

- **Visitor arms:** `regexMutator` in `Mutator.ts:1110-1163` (`isRegexLiteral`, `isObviousRegexString`, `mutateRegexPattern`).
- **Placement:**
  - Regex literal: `node.type === 'Literal'` with regex payload (e.g. `/^abc\d+$/g`).
  - Regex constructor with string literal argument: `new RegExp('^abc\\d+$', 'g')`.
- **Mutations emitted in order:**
  1. Anchor removal: `^` (bol) and `$` (eol) stripped (unless resulting pattern is empty).
  2. Character class negation: `[abc]` <-> `[^abc]`.
  3. Predefined character class negation: `\d` <-> `\D`, `\w` <-> `\W`, `\s` <-> `\S`, `\p{...}` <-> `\P{...}`.
  4. Quantifier removal: `a+`, `a*`, `a{2,3}` stripped to `a`.
  5. Lookaround negation: `(?=a)` <-> `(?!a)`, `(?<=a)` <-> `(?<!a)`.
- **Exclusions:** Alternations (`|`) and groupings (`(...)`) are deliberately untouched. Empty or unparseable patterns yield zero mutants.

---

## 16-Family Mutator Specifications

### ArithmeticOperator {#arithmeticoperator}

- **Visitor arms:** `arithmeticOperatorMutator` (`Mutator.ts:480-527`).
- **AST matched:** `BinaryExpression` where `operator` is one of `+`, `-`, `*`, `/`, `%`.
- **AST excluded:**
  - Private identifiers on the left operand: `left.type === 'PrivateIdentifier'` (`isPrivateInExpression`).
  - String concatenation (`isStringConcatenation`): when `isStringLike(node.right)` or `isStringLike(outerLeftOperand(node))` is true. `isStringLike` matches `StringLiteral` or `TemplateLiteral`. For chained expressions `a + b + c`, `outerLeftOperand` inspects `node.left.right`.
- **Emitted replacements:**
  - `+` -> `-`
  - `-` -> `+`
  - `*` -> `/`
  - `/` -> `*`
  - `%` -> `*`

### ArrayDeclaration {#arraydeclaration}

- **Visitor arms:** `arrayDeclarationMutator` (`Mutator.ts:529-576`).
- **AST matched:**
  - `ArrayExpression`:
    - Non-empty elements (`elements.length > 0`): replaced by empty array `[]`.
    - Empty elements (`elements.length === 0`): replaced by `['Stryker was here']`.
  - `ArrayConstructorCall` (`CallExpression` or `NewExpression` where callee is identifier `'Array'`):
    - With arguments (`args.length > 0`): replaced with empty argument list `[]` (e.g. `Array(1, 2)` -> `Array()`).
    - Without arguments (`args.length === 0`): replaced with single empty array argument `[[]]` (e.g. `Array()` -> `Array([])`).
- **AST excluded:** Non-Array calls/constructors.

### ArrowFunction {#arrowfunction}

- **Visitor arms:** `arrowFunctionMutator` (`Mutator.ts:578-594`).
- **AST matched:** `ArrowFunctionExpression` where `body.type !== 'BlockStatement'` and body is not an identifier named `'undefined'`.
- **AST excluded:**
  - Arrow functions with block bodies (e.g. `() => { return 1; }`).
  - Arrow functions whose concise body is already `undefined` (e.g. `() => undefined`).
- **Emitted replacements:** `() => undefined`.

### AssignmentOperator {#assignmentoperator}

- **Visitor arms:** `assignmentOperatorMutator` (`Mutator.ts:596-656`).
- **AST matched:** `AssignmentExpression` where operator is in `['+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '&&=', '||=', '??=']`.
- **AST excluded:**
  - Compound assignments where `node.right` is string-like (`StringLiteral` or `TemplateLiteral`), except for logical assignments `&&=`, `||=`, `??=`.
- **Emitted replacements:**
  - `+=` -> `-=`
  - `-=` -> `+=`
  - `*=` -> `/=`
  - `/=` -> `*=`
  - `%=` -> `*=`
  - `<<=` -> `>>=`
  - `>>=` -> `<<=`
  - `&=` -> `|=`
  - `|=` -> `&=`
  - `&&=` -> `||=`
  - `||=` -> `&&=`
  - `??=` -> `&&=`

### BlockStatement {#blockstatement}

- **Visitor arms:** `blockStatementMutator` (`Mutator.ts:658-756`).
- **AST matched:** `BlockStatement` where `node.body.length > 0` and is not an invalid constructor body.
- **AST excluded:**
  - Empty blocks (`{}`).
  - Derived constructor bodies that call `super(...)` when the class contains initialized property definitions or TS parameter properties (`isInvalidConstructorBody`).
- **Emitted replacements:** `{}` (empty block).

### BooleanLiteral {#booleanliteral}

- **Visitor arms:** `booleanLiteralMutator` (`Mutator.ts:758-781`).
- **AST matched:**
  - `Literal` with boolean value (`typeof node.value === 'boolean'`).
  - `UnaryExpression` with prefix `'!'` (`isNegatedPrefix`).
- **AST excluded:** Non-boolean literals, non-`!` unary expressions.
- **Emitted replacements:**
  - `true` -> `false`
  - `false` -> `true`
  - `!x` -> `x`

### ConditionalExpression {#conditionalexpression}

- **Visitor arms:** `conditionalExpressionMutator` (`Mutator.ts:785-894`).
- **AST matched & replacements:**
  - Loop test (`ForStatement`, `WhileStatement`, `DoWhileStatement` where `parent.test === node`): emits `false` (1 mutant).
  - If condition (`IfStatement` where `parent.test === node`): emits `true` and `false` (2 mutants).
  - Boolean expression in `LogicalExpression` with parent `&&`: emits `true` (1 mutant).
  - Boolean expression in `LogicalExpression` with parent `||`: emits `false` (1 mutant).
  - Other boolean expressions / conditional expressions (`a ? b : c`): emits `true` and `false` (2 mutants).
  - `ForStatement` with empty test (`for (;;)`): emits loop with test `false` (`for (;false;)`).
  - `SwitchCase` with non-empty consequent: emits switch case with empty consequent `[]`.
- **AST excluded:** Unmatched statements and non-boolean expressions.

### EqualityOperator {#equalityoperator}

- **Visitor arms:** `equalityOperatorMutator` (`Mutator.ts:903-930`).
- **AST matched:** `BinaryExpression` where operator is in `['<', '<=', '>', '>=', '==', '!=', '===', '!==']`.
- **AST excluded:** Private identifiers on the left.
- **Emitted replacements:**
  - `<` -> `<=` and `>=` (2 mutants)
  - `<=` -> `<` and `>` (2 mutants)
  - `>` -> `>=` and `<=` (2 mutants)
  - `>=` -> `>` and `<` (2 mutants)
  - `==` -> `!=` (1 mutant)
  - `!=` -> `==` (1 mutant)
  - `===` -> `!==` (1 mutant)
  - `!==` -> `===` (1 mutant)

### LogicalOperator {#logicaloperator}

- **Visitor arms:** `logicalOperatorMutator` (`Mutator.ts:932-954`).
- **AST matched:** `LogicalExpression` where operator is `&&`, `||`, or `??`.
- **AST excluded:** Non-logical expressions.
- **Emitted replacements:**
  - `&&` -> `||`
  - `||` -> `&&`
  - `??` -> `&&`

### MethodExpression {#methodexpression}

- **Visitor arms:** `methodExpressionMutator` (`Mutator.ts:956-1075`).
- **AST matched:** `CallExpression` where callee is a non-super static member expression matching known methods.
- **AST excluded:**
  - Calls where callee object is `Super`.
  - Methods not in the replacement dictionary.
  - Computed member calls (`obj[fn]()`).
- **Emitted replacements:**
  - Removal methods (`charAt`, `filter`, `reverse`, `slice`, `sort`, `substr`, `substring`, `trim`): calls the object directly (`callExpression(callee.object, [])`).
  - Inverted methods (`endsWith` <-> `startsWith`, `every` <-> `some`, `toLocaleLowerCase` <-> `toLocaleUpperCase`, `toLowerCase` <-> `toUpperCase`, `trimEnd` <-> `trimStart`, `min` <-> `max`, `setDate` <-> `setTime`, `setFullYear` <-> `setMonth`, `setHours` <-> `setMinutes`, `setSeconds` <-> `setMilliseconds`, `setUTCDate` -> `setTime`, `setUTCFullYear` <-> `setUTCMonth`, `setUTCHours` <-> `setUTCMinutes`, `setUTCSeconds` <-> `setUTCMilliseconds`).

### ObjectLiteral {#objectliteral}

- **Visitor arms:** `objectLiteralMutator` (`Mutator.ts:1077-1085`).
- **AST matched:** `ObjectExpression` where `properties.length > 0`.
- **AST excluded:** Empty object literal `{}`.
- **Emitted replacements:** `{}` (empty object literal).

### OptionalChaining {#optionalchaining}

- **Visitor arms:** `optionalChainingMutator` (`Mutator.ts:1087-1106`).
- **AST matched:** `MemberExpression` or `CallExpression` with `optional === true`.
- **AST excluded:** Non-optional member or call expressions.
- **Emitted replacements:** Same node with `optional: false` (`a?.b` -> `a.b`, `a?.[k]` -> `a[k]`, `a?.()` -> `a()`).

### Regex {#regex}

- **Visitor arms:** `regexMutator` (`Mutator.ts:1108-1163`).
- **AST matched:**
  - `Literal` carrying regex pattern/flags.
  - `NewExpression` of `RegExp` where the first argument is a string literal (`isObviousRegexString`).
- **AST excluded:** Non-literal regex constructors, empty patterns, syntax errors in patterns.
- **Emitted replacements:** Mutated regex patterns via `mutateRegexPattern`:
  - Anchor removal (`^`, `$`).
  - Character class negation (`[...]` <-> `[^...]`).
  - Predefined class negation (`\d` <-> `\D`, `\w` <-> `\W`, `\s` <-> `\S`, `\p` <-> `\P`).
  - Quantifier removal (`+`, `*`, `{n,m}` stripped).
  - Lookaround negation (`(?=)` <-> `(?!)`, `(?<=)` <-> `(?<!)`).

### StringLiteral {#stringliteral}

- **Visitor arms:** `stringLiteralMutator` (`Mutator.ts:1165-1253`).
- **AST matched:**
  - `TemplateLiteral`: first quasi mutated.
  - `StringLiteral`: literal value mutated.
- **AST excluded:**
  - Import/export statements (`ImportDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ExportAllDeclaration`, `TSExternalModuleReference`).
  - JSX attributes, expression statements (e.g. directive prologues `"use strict"`), literal types (`TSLiteralType`).
  - Object/class property keys (`Property`, `PropertyDefinition`).
  - Object methods (`node.method === true`).
  - Callee arguments for `require(...)`, `Symbol(...)`, or `import(...)`.
- **Emitted replacements:**
  - Empty string `""` -> `'Stryker was here!'`
  - Non-empty string -> `""`
  - Empty template literal -> `Stryker was here!`
  - Non-empty template literal -> ``

### UnaryOperator {#unaryoperator}

- **Visitor arms:** `unaryOperatorMutator` (`Mutator.ts:1269-1308`).
- **AST matched:** `UnaryExpression` with `prefix === true` and operator in `['+', '-', '~']`.
- **AST excluded:**
  - Operator `!` (strictly owned by `BooleanLiteral`).
  - Operators `typeof`, `void`, `delete`.
- **Emitted replacements:**
  - `+` -> `-`
  - `-` -> `+`
  - `~` -> `""` (strips operator).

### UpdateOperator {#updateoperator}

- **Visitor arms:** `updateOperatorMutator` (`Mutator.ts:1310-1325`).
- **AST matched:** `UpdateExpression` (both prefix and postfix).
- **AST excluded:** Non-update expressions.
- **Emitted replacements:**
  - `++` -> `--`
  - `--` -> `++`
