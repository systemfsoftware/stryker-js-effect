import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { MutationRangeSpecifier, MutationRangeSpecifierSchema } from '../MutationRange.schema.js'

const DecodedOptions = S.toType(Options.StrykerOptionsSchema)

const decodeOptions = S.decodeUnknownResult(Options.StrykerOptionsSchema, { errors: 'all' })

const decodeMutationRange = S.decodeOption(MutationRangeSpecifierSchema)

const ValidationSchemaDocumentSchema = S.toType(S.Record(S.String, S.Unknown))

const isNonNullObject = (value: unknown): value is object => Boolean.and(typeof value === 'object', value !== null)

const ValidateOptionsDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ValidateOptionsDecision')
type ValidateOptionsDecisionTypeId = typeof ValidateOptionsDecisionTypeId

export type ValidationSchemaDocument<A = unknown> = {
  readonly properties?: A
  readonly [key: string]: A
}

export class ValidateOptionsCommand extends S.TaggedClass<ValidateOptionsCommand>()('ValidateOptionsCommand', {
  options: S.Record(S.String, S.Unknown),
  schema: ValidationSchemaDocumentSchema,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class OptionsValidated extends S.TaggedClass<OptionsValidated>()('OptionsValidated', {
  options: DecodedOptions,
  warnings: S.Array(S.String),
}) {
  readonly [ValidateOptionsDecisionTypeId] = ValidateOptionsDecisionTypeId
}

export class OptionsRefused extends S.TaggedClass<OptionsRefused>()('OptionsRefused', {
  errors: S.Array(S.String),
  warnings: S.Array(S.String),
}) {
  readonly [ValidateOptionsDecisionTypeId] = ValidateOptionsDecisionTypeId
}

export class OptionsUndecodable extends S.TaggedClass<OptionsUndecodable>()('OptionsUndecodable', {
  message: S.String,
  warnings: S.Array(S.String),
}) {
  readonly [ValidateOptionsDecisionTypeId] = ValidateOptionsDecisionTypeId
}

export type OptionsValidationDecision = OptionsValidated | OptionsRefused | OptionsUndecodable

const ignoreStaticErrors = (options: Options.StrykerOptions): readonly string[] =>
  Match.value(Boolean.and(options.ignoreStatic, options.coverageAnalysis !== 'perTest')).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "ignoreStatic" is not supported with coverage analysis "${options.coverageAnalysis}". Either turn off "ignoreStatic", or configure "coverageAnalysis" to be "perTest".`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const startLineErrors = (
  index: number,
  mutationRange: string | undefined,
  start: number,
): readonly string[] =>
  Match.value(start < 1).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Mutation range "${mutationRange}" is invalid, line ${start} does not exist (lines start at 1).`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const lineOrderErrors = (
  index: number,
  mutationRange: string | undefined,
  start: number,
  end: number,
): readonly string[] =>
  Match.value(start > end).pipe(
    Match.when(true, (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Mutation range "${mutationRange}" is invalid. The "from" line number (${start}) should be less then the "to" line number (${end}).`,
    ]),
    Match.orElse((): readonly string[] => []),
  )

const columnSuffixOf = (column: number | undefined): string =>
  Option.match(Option.fromUndefinedOr(column), {
    onNone: () => '',
    onSome: (present) => `:${present}`,
  })

const rangeTextOf = (specifier: MutationRangeSpecifier): string =>
  `${specifier.startLine}${columnSuffixOf(specifier.startColumn)}-${specifier.endLine}${
    columnSuffixOf(specifier.endColumn)
  }`

const mutationRangeBoundErrors = (index: number, specifier: MutationRangeSpecifier): readonly string[] => [
  ...startLineErrors(index, rangeTextOf(specifier), specifier.startLine),
  ...lineOrderErrors(index, rangeTextOf(specifier), specifier.startLine, specifier.endLine),
]

const GLOB_META = /[*?[{]/

const isGlob = (value: string) => GLOB_META.test(value)

const requireUnmagicalMutationRange = (
  mutateString: string,
  index: number,
  specifier: MutationRangeSpecifier,
): readonly string[] =>
  Boolean.match(isGlob(mutateString), {
    onTrue: (): readonly string[] => [
      `Config option "mutate[${index}]" is invalid. Cannot combine a glob expression with a mutation range in "${mutateString}".`,
    ],
    onFalse: () => mutationRangeBoundErrors(index, specifier),
  })

const mutationRangeErrors = (mutateString: string, index: number): readonly string[] =>
  Option.match(decodeMutationRange(mutateString), {
    onNone: (): readonly string[] => [],
    onSome: (specifier) => requireUnmagicalMutationRange(mutateString, index, specifier),
  })

const IGNORED_NODE_ARGS_WARNING =
  'Using "testRunnerNodeArgs" together with the "command" test runner is not supported, these arguments will be ignored. You can add your custom arguments by setting the "commandRunner.command" option.'

const isCommandRunnerName = (name: Options.TestRunnerConfig): boolean =>
  Match.value(name).pipe(
    Match.when(Match.string, (value) => value.toLowerCase() === 'command'),
    Match.orElse(() => false),
  )

const commandRunnerWarningsOf = (options: Options.StrykerOptions): readonly string[] =>
  Boolean.match(Boolean.and(isCommandRunnerName(options.testRunner), options.testRunnerNodeArgs.length > 0), {
    onTrue: (): readonly string[] => [IGNORED_NODE_ARGS_WARNING],
    onFalse: (): readonly string[] => [],
  })

const customValidationErrors = (options: Options.StrykerOptions): readonly string[] => [
  ...ignoreStaticErrors(options),
  ...options.mutate.flatMap(mutationRangeErrors),
]

const OPTIONS_ADDED_BY_STRYKER: readonly string[] = ['set', 'configFile', '$schema']

const schemaPropertyNames = (schema: ValidationSchemaDocument): readonly string[] =>
  Match.value(schema['properties']).pipe(
    Match.when(isNonNullObject, (properties) => Object.keys(properties)),
    Match.orElse((): readonly string[] => []),
  )

const excessOptionNames = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] => {
  const schemaKeys = schemaPropertyNames(schema)
  return Object.keys(options)
    .filter((key) => key.endsWith('_comment') === false)
    .filter((key) => OPTIONS_ADDED_BY_STRYKER.includes(key) === false)
    .filter((key) => schemaKeys.includes(key) === false)
}

const warningRequested = (
  warning: 'unknownOptions' | 'unserializableOptions',
  warnings: Options.StrykerOptions['warnings'],
): boolean =>
  Match.value(warnings).pipe(
    Match.when(S.is(S.Boolean), (global) => global),
    Match.orElse((configured) => configured[warning] === true),
  )

const pluginsJson = (options: Options.StrykerOptions): string =>
  Result.getOrElse(
    S.encodeResult(S.String.pipe(S.Array, S.fromJsonString))([...options.plugins]),
    () => '[]',
  )

const POSSIBLE_CAUSES_OF = (loadedPlugins: string): string =>
  `Possible causes:
     * Is it a typo on your end?
     * Did you only write this property as a comment? If so, please postfix it with "_comment".
     * You might be missing a plugin that is supposed to use it. Stryker loaded plugins from: ${loadedPlugins}
     * The plugin that is using it did not contribute explicit validation. 
      (disable "warnings.unknownOptions" to ignore this warning)`

const unknownOptionWarnings = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] => {
  const excessNames = excessOptionNames(options, schema)
  return excessNames.map((excess) => `Unknown stryker config option "${excess}".`).concat(
    POSSIBLE_CAUSES_OF(pluginsJson(options)),
  )
}

const excessOptionWarningsOf = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] =>
  Match.value(warningRequested('unknownOptions', options.warnings)).pipe(
    Match.when(true, () => unknownOptionWarnings(options, schema)),
    Match.orElse((): readonly string[] => []),
  )

type UnserializableDescription = {
  readonly path: ReadonlyArray<string>
  readonly reason: string
}

const NON_JSON_PRIMITIVE_TYPES: Record<string, true> = {
  bigint: true,
  function: true,
  symbol: true,
}

const scopedUnserializable =
  (scope: string) => (description: UnserializableDescription): UnserializableDescription => ({
    ...description,
    path: [scope, ...description.path],
  })

const describedChild = <A>(scope: string) => (child: A): UnserializableDescription[] =>
  Option.match(Option.fromUndefinedOr(findUnserializables(child)), {
    onNone: () => [],
    onSome: (descriptions) => descriptions.map(scopedUnserializable(scope)),
  })

const describedEntries = <A>(
  entries: ReadonlyArray<readonly [string, A]>,
): UnserializableDescription[] => entries.flatMap(([scope, child]) => describedChild(scope)(child))

const classNameOf = (value: object): string =>
  Match.value(value.constructor).pipe(
    Match.when(Match.defined, (constructor) => constructor.name),
    Match.orElse(() => 'Object'),
  )

const describeUnserializableInstance = (value: object): UnserializableDescription[] => [
  {
    path: [],
    reason: `Value is an instance of "${
      classNameOf(
        value,
      )
    }", this detail will get lost in translation during serialization`,
  },
]

const isArrayValue = <A = unknown>(value: unknown): value is ReadonlyArray<A> => Array.isArray(value)

const isPlainObjectValue = (value: object): boolean =>
  Boolean.and(Array.isArray(value) === false, value.constructor === Object)

const describedIndexedChildren = <A = unknown>(arrayed: ReadonlyArray<A>): UnserializableDescription[] =>
  describedEntries(arrayed.map((child, index) => [index.toString(), child] as const))

const describeUnserializableObject = (value: object): UnserializableDescription[] =>
  Match.value(value).pipe(
    Match.when(isArrayValue, describedIndexedChildren),
    Match.orElse((recorded) =>
      Option.match(
        Option.liftPredicate(recorded, isPlainObjectValue),
        {
          onNone: () => describeUnserializableInstance(recorded),
          onSome: (plain) => describedEntries(Object.entries(plain)),
        },
      )
    ),
  )

const describeUnserializableNonNullish = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNonNullObject), {
    onNone: () => [],
    onSome: (present) => describeUnserializableObject(present),
  })

const isNumberValue = (value: unknown): value is number => typeof value === 'number'

type JsonlessPrimitive = bigint | symbol | ((...args: never[]) => void)

const isNonJsonPrimitive = (value: unknown): value is JsonlessPrimitive =>
  NON_JSON_PRIMITIVE_TYPES[typeof value] === true

const primitiveKindOf = (primitive: JsonlessPrimitive): string => typeof primitive

const describeUnserializablePrimitive = (primitive: JsonlessPrimitive): UnserializableDescription[] => [
  {
    path: [],
    reason: `Primitive type "${primitiveKindOf(primitive)}" has no JSON representation`,
  },
]

const describeUnserializableUnknown = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNonJsonPrimitive), {
    onNone: () => describeUnserializableNonNullish(value),
    onSome: describeUnserializablePrimitive,
  })

const hasDescriptions = (found: UnserializableDescription[]): boolean => found.length > 0

const describeUnserializableFiniteNumber = (value: number): UnserializableDescription[] =>
  Boolean.match(Number.isFinite(value), {
    onTrue: () => [],
    onFalse: () => [
      {
        path: [],
        reason: `Number value \`${value}\` has no JSON representation`,
      },
    ],
  })

const describeUnserializableValue = <A>(value: A): UnserializableDescription[] =>
  Option.match(Option.liftPredicate(value, isNumberValue), {
    onNone: () => describeUnserializableUnknown(value),
    onSome: describeUnserializableFiniteNumber,
  })

const findUnserializables = <A>(thing: A): UnserializableDescription[] | undefined =>
  Option.match(
    Option.filter(Option.some(describeUnserializableValue(thing)), hasDescriptions),
    {
      onNone: () => undefined,
      onSome: (found) => found,
    },
  )

const unserializableWarningsOf = (options: Options.StrykerOptions): readonly string[] =>
  Option.match(Option.fromUndefinedOr(findUnserializables(options)), {
    onNone: (): readonly string[] => [],
    onSome: (unserializables) =>
      unserializables
        .map((unserializable) =>
          `Config option "${
            unserializable.path.join('.')
          }" is not (fully) serializable. ${unserializable.reason}. Any test runner or checker worker processes might not receive this value as intended.`
        )
        .concat('(disable "warnings.unserializableOptions" to ignore this warning)'),
  })

const unserializableOptionsWarningsOf = (options: Options.StrykerOptions): readonly string[] =>
  Match.value(warningRequested('unserializableOptions', options.warnings)).pipe(
    Match.when(true, () => unserializableWarningsOf(options)),
    Match.orElse((): readonly string[] => []),
  )

const markOptions = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): readonly string[] => [
  ...excessOptionWarningsOf(options, schema),
  ...unserializableOptionsWarningsOf(options),
]

const validatedOf = (
  options: Options.StrykerOptions,
  schema: ValidationSchemaDocument,
): OptionsValidationDecision => {
  const customErrors = customValidationErrors(options)
  return Boolean.match(customErrors.length === 0, {
    onTrue: () =>
      OptionsValidated.make({
        options,
        warnings: [...commandRunnerWarningsOf(options), ...markOptions(options, schema)],
      }),
    onFalse: () => OptionsRefused.make({ errors: customErrors, warnings: commandRunnerWarningsOf(options) }),
  })
}

const validationDecisionOf = (command: ValidateOptionsCommand): OptionsValidationDecision =>
  Result.match(decodeOptions(command.options), {
    onFailure: (failure) => OptionsUndecodable.make({ message: failure.message, warnings: [] }),
    onSuccess: (options) => validatedOf(options, command.schema),
  })

export const validateOptionsAdmission = Workflow.make({
  command: ValidateOptionsCommand,
  decision: S.Union([OptionsValidated, OptionsRefused, OptionsUndecodable]),
  error: S.Never,
  decide: (command: ValidateOptionsCommand) => Result.succeed(validationDecisionOf(command)),
})
