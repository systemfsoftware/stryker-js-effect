import { Workflow } from '@systemfsoftware/effect-cell-types';
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface';
import * as S from 'effect/Schema';
declare const DiagnosticSchema: S.Struct<{
    readonly fileName: S.optional<S.NonEmptyString>;
    readonly text: S.String;
}>;
export interface NodeDecodedShape {
    readonly fileName: string;
    readonly parents: readonly NodeDecodedShape[];
    readonly children: readonly NodeDecodedShape[];
}
declare const CheckMutantsInput_base: S.Class<CheckMutantsInput, S.TaggedStruct<"CheckMutantsInput", {
    readonly mutants: S.$Array<S.Struct<{
        readonly id: S.brand<S.NonEmptyString, "MutantId">;
        readonly fileName: S.decodeTo<S.brand<S.String, "CanonicalFileName">, S.String, never, never>;
        readonly mutatorName: S.brand<S.NonEmptyString, "MutatorName">;
        readonly replacement: S.String;
        readonly location: S.Struct<{
            readonly start: S.Struct<{
                readonly line: S.Int;
                readonly column: S.Int;
            }>;
            readonly end: S.Struct<{
                readonly line: S.Int;
                readonly column: S.Int;
            }>;
        }>;
    }>>;
    readonly diagnostics: S.$Array<S.Struct<{
        readonly fileName: S.optional<S.NonEmptyString>;
        readonly text: S.String;
    }>>;
    readonly nodes: S.$Record<S.NonEmptyString, S.Codec<NodeDecodedShape, NodeDecodedShape, never, never>>;
}>, {}>;
export declare class CheckMutantsInput extends CheckMutantsInput_base {
    static readonly [Workflow.InstrumentationBrand]: {};
}
export type MutantDecoded = Checker.CheckerMutantWire;
export type DiagnosticDecoded = S.Schema.Type<typeof DiagnosticSchema>;
export type NodeDecoded = NodeDecodedShape;
export {};
