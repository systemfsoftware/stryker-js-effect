import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import { ErrorText } from './ErrorText.schema.js'
import type { MutantNotApplied } from './Mutant.schema.js'

export type TransformerFailure =
  | MutantPlacementFailed
  | NodeKindMismatch
  | DirectiveIncomplete
  | CommentLocationMissing
  | MutantsUnplaced
  | PlacementMissing
  | HeaderEmpty
  | MutantNotApplied

export class MutantPlacementFailed
  extends S.TaggedError<MutantPlacementFailed>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/MutantPlacementFailed')(
    'MutantPlacementFailed',
    {
      fileName: S.String,
      line: S.optional(S.Finite),
      column: S.optional(S.Finite),
      placerName: S.String,
      mutatorNames: S.Array(S.String),
      cause: S.Defect(),
    },
  )
{
  override get message(): string {
    return `${
      placementLocation(this)
    } ${this.placerName} could not place mutants with type(s): "${
      PLACEMENT_LIST_FORMAT.format(this.mutatorNames)
    }". Either remove this file from the list of files to be mutated, or exclude the mutator (using \`mutator.excludedMutations\`). Original error: ${stackOf(this.cause)}`
  }
}

const PLACEMENT_LIST_FORMAT = new Intl.ListFormat('en')

interface PlacementSite {
  readonly fileName: string
  readonly line?: number | undefined
  readonly column?: number | undefined
}

const placementSiteText = (value: number | undefined): string =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => 'undefined',
    onSome: (present) => String(present),
  })

const placementLocation = (site: PlacementSite): string =>
  `${site.fileName}:${placementSiteText(site.line)}:${placementSiteText(site.column)}`

const hasStackText = (value: unknown): value is { readonly stack: string } =>
  Predicate.isObject(value) && Predicate.isString(value['stack'])

const stackOf = <A>(cause: A): string =>
  Option.match(Option.filter(Option.some(cause), hasStackText), {
    onNone: () => Option.getOrElse(S.decodeUnknownOption(ErrorText)(cause), () => ''),
    onSome: (thrown) => thrown.stack,
  })

export class NodeKindMismatch
  extends S.TaggedError<NodeKindMismatch>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/NodeKindMismatch')(
    'NodeKindMismatch',
    {
      expected: S.String,
      actual: S.String,
      mutantId: S.optional(S.String),
    },
  )
{
  override get message(): string {
    return Option.match(Option.fromNullishOr(this.mutantId), {
      onNone: () => `Expected ${this.expected}, got ${this.actual}`,
      onSome: (mutantId) => `Cannot place mutant ${mutantId}: expected ${this.expected}, got ${this.actual}`,
    })
  }
}

export class DirectiveIncomplete
  extends S.TaggedError<DirectiveIncomplete>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/DirectiveIncomplete')(
    'DirectiveIncomplete',
    {},
  )
{
  override get message(): string {
    return 'Stryker directive without directive type or mutators'
  }
}

export class CommentLocationMissing
  extends S.TaggedError<CommentLocationMissing>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/CommentLocationMissing')(
    'CommentLocationMissing',
    {},
  )
{
  override get message(): string {
    return 'Comment without location'
  }
}

export class MutantsUnplaced
  extends S.TaggedError<MutantsUnplaced>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/MutantsUnplaced')(
    'MutantsUnplaced',
    { mutants: S.String },
  )
{
  override get message(): string {
    return `Mutants cannot be placed. This shouldn't happen! Unplaced mutants: ${this.mutants}`
  }
}

export class PlacementMissing
  extends S.TaggedError<PlacementMissing>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/PlacementMissing')(
    'PlacementMissing',
    {},
  )
{
  override get message(): string {
    return 'Placement not found for node'
  }
}

export class HeaderEmpty
  extends S.TaggedError<HeaderEmpty>('@systemfsoftware/stryker-js-instrumenter/Transformer.schema/HeaderEmpty')(
    'HeaderEmpty',
    {},
  )
{
  override get message(): string {
    return 'Instrumentation header is empty'
  }
}
