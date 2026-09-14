export interface NodePath {
  readonly node: unknown
  readonly parentPath?: NodePath | null
}

export interface PlainIgnorer {
  readonly name: string
  shouldIgnore(path: NodePath): string | undefined
}

export function* ancestorsOf(path: NodePath): Generator<unknown> {
  for (let current = path.parentPath; current; current = current.parentPath) {
    yield current.node
  }
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output> | undefined
  }
  export type Result<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<Issue> }
  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }
  export interface PathSegment {
    readonly key: PropertyKey
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['input']
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema['~standard']['types']>['output']
}
