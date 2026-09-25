import { Workflow } from '@systemfsoftware/effect-cell-types'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

export interface RawVitestRecord<A = unknown> {
  readonly [key: string]: A
}

type TaskState = 'pass' | 'fail' | 'skip' | 'todo' | 'run' | 'queued' | 'only' | undefined

const isRecordValue = <A = unknown>(value: unknown): value is RawVitestRecord<A> => Predicate.isObject(value)

const recordOption = <A = unknown>(value: A): Option.Option<RawVitestRecord<A>> =>
  Option.liftPredicate(value, isRecordValue<A>)

const asStringOption = <A = unknown>(value: A): Option.Option<string> => Option.liftPredicate(value, Predicate.isString)

const asNumberOption = <A = unknown>(value: A): Option.Option<number> => Option.liftPredicate(value, Predicate.isNumber)

const asArrayOption = <A = unknown>(value: A): Option.Option<readonly A[]> => Option.liftPredicate(value, Array.isArray)

const getStringField = <A = unknown>(record: RawVitestRecord<A>, key: string): Option.Option<string> =>
  asStringOption(record[key])

const getNumberField = <A = unknown>(record: RawVitestRecord<A>, key: string): Option.Option<number> =>
  asNumberOption(record[key])

const getSuite = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['suite']))

const getFile = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['file']))

const getResult = <A = unknown>(value: A): Option.Option<A> =>
  Option.flatMap(recordOption(value), (rec) => Option.fromNullishOr(rec['result']))

const getErrors = <A = unknown>(value: A): Option.Option<readonly A[]> =>
  Option.flatMap(recordOption(value), (rec) => asArrayOption(rec['errors']))

const getMessage = <A = unknown>(value: A): Option.Option<string> =>
  Option.flatMap(recordOption(value), (rec) => getStringField(rec, 'message'))

const getName = <A = unknown>(value: A): string =>
  Option.match(recordOption(value), {
    onNone: () => '',
    onSome: (rec) => Option.getOrElse(getStringField(rec, 'name'), () => ''),
  })

const getMode = <A = unknown>(value: A): string =>
  Option.match(recordOption(value), {
    onNone: () => 'run',
    onSome: (rec) => Option.getOrElse(getStringField(rec, 'mode'), () => 'run'),
  })

const TASK_STATES: Readonly<Record<string, TaskState>> = Object.freeze({
  pass: 'pass',
  fail: 'fail',
  skip: 'skip',
  todo: 'todo',
  run: 'run',
  queued: 'queued',
  only: 'only',
})

const getState = <A = unknown>(value: A): TaskState =>
  Option.match(asStringOption(value), {
    onNone: (): TaskState => undefined,
    onSome: (state): TaskState => TASK_STATES[state],
  })

const getDuration = <A = unknown>(value: A): number =>
  Option.match(recordOption(value), {
    onNone: () => 0,
    onSome: (rec) => Option.getOrElse(getNumberField(rec, 'duration'), () => 0),
  })

const getFilepath = <A = unknown>(value: A): string | undefined =>
  Option.match(recordOption(value), {
    onNone: (): string | undefined => undefined,
    onSome: (rec): string | undefined => Option.getOrUndefined(getStringField(rec, 'filepath')),
  })

const collectSuiteNames = <A = unknown>(suite: A): readonly string[] =>
  Option.match(Option.fromNullishOr(suite), {
    onNone: (): readonly string[] => [],
    onSome: (current): readonly string[] =>
      Option.match(recordOption(current), {
        onNone: (): readonly string[] => [],
        onSome: (rec): readonly string[] => {
          const name = Option.getOrElse(getStringField(rec, 'name'), () => '')
          const hasName = name.length > 0
          const parentNames = collectSuiteNames(rec['suite'])
          return Match.value(hasName).pipe(
            Match.when(true, (): readonly string[] => [...parentNames, name]),
            Match.when(false, (): readonly string[] => parentNames),
            Match.exhaustive,
          )
        },
      }),
  })

const collectTestNameRaw = <A = unknown>(test: A): string =>
  Option.match(Option.flatMap(recordOption(test), (rec) => getStringField(rec, 'fullTestName')), {
    onSome: (fullTestName) => fullTestName,
    onNone: (): string => {
      const name = getName(test)
      const suite = Option.getOrUndefined(getSuite(test))
      const suiteNames = collectSuiteNames(suite)
      const parts = [...suiteNames, name]
      return parts.join(' > ').trim()
    },
  })

const toRawTestIdRaw = <A = unknown>(test: A): string => {
  const filepath = Option.match(getFile(test), {
    onNone: (): string => 'unknown.js',
    onSome: (file): string => Option.getOrElse(Option.fromNullishOr(getFilepath(file)), (): string => 'unknown.js'),
  })
  return `${filepath}#${collectTestNameRaw(test)}`
}

const stripProjectRoot = (file: string, projectRoot: string): string =>
  Match.value(file.startsWith(projectRoot)).pipe(
    Match.when(true, (): string => file.slice(projectRoot.length)),
    Match.when(false, (): string => file),
    Match.exhaustive,
  )

const toProjectRelativePath = (file: string): string => file.replace(/^[/\\]+/, '').replaceAll('\\', '/')

const normalizeTestIdRaw = (id: string, projectRoot: string): string => {
  const hash = id.indexOf('#')
  return Match.value(hash === -1).pipe(
    Match.when(true, (): string => id),
    Match.when(false, (): string => {
      const file = toProjectRelativePath(stripProjectRoot(id.slice(0, hash), projectRoot))
      return `${file}#${id.slice(hash + 1)}`
    }),
    Match.exhaustive,
  )
}

const toTestStatus = (taskState: TaskState, mode: string): TestRunner.TestStatus =>
  Match.value(mode === 'skip').pipe(
    Match.when(true, (): TestRunner.TestStatus => 'skipped'),
    Match.when(false, (): TestRunner.TestStatus =>
      Match.value(taskState).pipe(
        Match.when('pass', (): TestRunner.TestStatus => 'success'),
        Match.when('skip', (): TestRunner.TestStatus => 'skipped'),
        Match.when('todo', (): TestRunner.TestStatus => 'skipped'),
        Match.orElse((): TestRunner.TestStatus => 'failed'),
      )),
    Match.exhaustive,
  )

const findSuiteErrorRaw = <A = unknown>(suite: A): string | undefined =>
  Option.match(Option.fromNullishOr(suite), {
    onNone: (): string | undefined => undefined,
    onSome: (current): string | undefined =>
      Option.match(recordOption(current), {
        onNone: (): string | undefined => undefined,
        onSome: (rec): string | undefined => {
          const maybeError = Option.flatMap(getResult(rec), (result) =>
            Option.flatMap(getErrors(result), (errs) =>
              Match.value(errs.length > 0).pipe(
                Match.when(true, () => Option.flatMap(Option.fromNullishOr(errs[0]), (first) => getMessage(first))),
                Match.when(false, () => Option.none()),
                Match.exhaustive,
              )))
          return Option.match(maybeError, {
            onNone: (): string | undefined =>
              findSuiteErrorRaw(rec['suite']),
            onSome: (msg): string | undefined => msg,
          })
        },
      }),
  })

const extractResultState = <A = unknown>(result: Option.Option<A>): Option.Option<TaskState> =>
  result.pipe(
    Option.getOrUndefined,
    Option.fromNullishOr,
    Option.flatMap((value) =>
      Option.match(recordOption(value), {
        onNone: (): Option.Option<TaskState> => Option.none(),
        onSome: (rec): Option.Option<TaskState> => Option.some(getState(rec['state'])),
      })
    ),
  )

const extractStatus = <A = unknown>(test: A): TestRunner.TestStatus =>
  toTestStatus(extractResultState(getResult(test)).pipe(Option.getOrUndefined), getMode(test))

const extractDuration = <A = unknown>(test: A): number =>
  Option.match(getResult(test), {
    onNone: (): number => 0,
    onSome: (result): number =>
      Option.match(recordOption(result), {
        onNone: (): number => 0,
        onSome: (rec): number => getDuration(rec),
      }),
  })

const extractFileName = <A = unknown>(test: A): string | undefined =>
  Option.match(getFile(test), {
    onNone: (): string | undefined => undefined,
    onSome: (file): string | undefined => getFilepath(file),
  })

const extractFailureMessage = <A = unknown>(test: A): string =>
  Option.match(getResult(test), {
    onNone: (): string => 'StrykerJS: Unknown test failure',
    onSome: (result): string =>
      Option.match(getErrors(result), {
        onNone: (): string => 'StrykerJS: Unknown test failure',
        onSome: (errs): string =>
          Match.value(errs.length > 0).pipe(
            Match.when(true, (): string =>
              Option.match(Option.fromNullishOr(errs[0]), {
                onNone: (): string => 'StrykerJS: Unknown test failure',
                onSome: (first): string =>
                  Option.getOrElse(getMessage(first), (): string => 'StrykerJS: Unknown test failure'),
              })),
            Match.when(false, (): string => 'StrykerJS: Unknown test failure'),
            Match.exhaustive,
          ),
      }),
  })

const convertTestRaw = <A = unknown>(test: A, projectRoot: string): TestRunner.TestResult => {
  const status = extractStatus(test)
  const fileNameField = Match.value(extractFileName(test)).pipe(
    Match.when(undefined, () => ({})),
    Match.orElse((fileName) => ({ fileName })),
  )
  const base = {
    id: normalizeTestIdRaw(toRawTestIdRaw(test), projectRoot),
    name: collectTestNameRaw(test),
    timeSpentMs: extractDuration(test),
    status,
    ...fileNameField,
  }
  return Match.value(status).pipe(
    Match.when(
      'failed',
      (): TestRunner.TestResult => ({ ...base, status: 'failed', failureMessage: extractFailureMessage(test) }),
    ),
    Match.when(
      'skipped',
      (): TestRunner.TestResult =>
        Match.value(getSuite(test).pipe(Option.getOrUndefined, findSuiteErrorRaw)).pipe(
          Match.when(
            Match.defined,
            (suiteError): TestRunner.TestResult => ({ ...base, status: 'failed', failureMessage: suiteError }),
          ),
          Match.orElse((): TestRunner.TestResult => ({ ...base, status: 'skipped' })),
        ),
    ),
    Match.orElse((): TestRunner.TestResult => ({ ...base, status: 'success' })),
  )
}

export const VitestTestRun = S.Unknown.pipe(
  S.decodeTo(
    S.Array(TestRunner.TestResultSchema),
    SchemaTransformation.transform({
      decode: (payload) =>
        Option.match(recordOption(payload), {
          onNone: (): readonly TestRunner.TestResult[] => [],
          onSome: (run): readonly TestRunner.TestResult[] => {
            const projectRoot = Option.getOrElse(getStringField(run, 'projectRoot'), () => '')
            const records = Option.getOrElse(asArrayOption(run['records']), (): readonly RawVitestRecord[] => [])
            return records.map((record) => convertTestRaw(record, projectRoot))
          },
        }),
      encode: (tests) => tests,
    }),
  ),
)

export class VitestDryRunCommand extends S.TaggedClass<VitestDryRunCommand>()('VitestDryRunCommand', {
  projectRoot: S.String,
  tests: VitestTestRun,
  hasExternalError: S.Boolean,
  externalErrorText: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    projectRoot: 'stryker.vitest.project_root',
  } as const
}

export class VitestMutantRunCommand extends S.TaggedClass<VitestMutantRunCommand>()('VitestMutantRunCommand', {
  tests: VitestTestRun,
  hasExternalError: S.Boolean,
  externalErrorText: S.String,
  hitCount: S.optional(S.Finite),
  hitLimit: S.optional(S.Finite),
  reportAllKillers: S.Boolean,
  activeMutantId: S.String,
  activeMutantFileName: S.String,
  timeoutTrapFile: S.optional(S.String),
  timeoutTrapMutantId: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    activeMutantId: 'stryker.vitest.active_mutant_id',
    reportAllKillers: 'stryker.vitest.report_all_killers',
  } as const
}
