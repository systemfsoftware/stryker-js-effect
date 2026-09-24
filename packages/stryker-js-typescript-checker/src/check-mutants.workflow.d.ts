import { Workflow } from '@systemfsoftware/effect-cell-types';
import * as S from 'effect/Schema';
import { CheckMutantsInput } from './CheckMutants.schema.js';
declare const DiagnosticWithoutFileError_base: S.Class<DiagnosticWithoutFileError, S.TaggedStruct<"DiagnosticWithoutFileError", {
    readonly text: S.String;
}>, import("effect/Cause").YieldableError>;
export declare class DiagnosticWithoutFileError extends DiagnosticWithoutFileError_base {
}
declare const DiagnosticInUnrelatedFileError_base: S.Class<DiagnosticInUnrelatedFileError, S.TaggedStruct<"DiagnosticInUnrelatedFileError", {
    readonly text: S.String;
    readonly fileName: S.String;
}>, import("effect/Cause").YieldableError>;
export declare class DiagnosticInUnrelatedFileError extends DiagnosticInUnrelatedFileError_base {
}
export type CheckMutantsError = DiagnosticWithoutFileError | DiagnosticInUnrelatedFileError;
declare const CheckMutantsTypeId: unique symbol;
type CheckMutantsTypeId = typeof CheckMutantsTypeId;
declare const CheckFinished_base: S.Class<CheckFinished, S.TaggedStruct<"CheckFinished", {
    readonly results: S.$Record<S.String, S.Union<readonly [S.Struct<{
        readonly status: S.Literal<"passed">;
    }>, S.Struct<{
        readonly status: S.Literal<"compileError">;
        readonly reason: S.String;
    }>]>>;
}>, {}>;
export declare class CheckFinished extends CheckFinished_base {
    readonly [CheckMutantsTypeId]: symbol;
}
declare const RetestRequired_base: S.Class<RetestRequired, S.TaggedStruct<"RetestRequired", {
    readonly results: S.$Record<S.String, S.Union<readonly [S.Struct<{
        readonly status: S.Literal<"passed">;
    }>, S.Struct<{
        readonly status: S.Literal<"compileError">;
        readonly reason: S.String;
    }>]>>;
    readonly needsRetest: S.$Array<S.Struct<{
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
}>, {}>;
export declare class RetestRequired extends RetestRequired_base {
    readonly [CheckMutantsTypeId]: symbol;
}
export type CheckMutantsDecision = CheckFinished | RetestRequired;
export type CheckMutantsAnswer = S.Codec.Encoded<typeof CheckFinished | typeof RetestRequired>;
export declare const checkMutants: Workflow.MadeWorkflow<typeof CheckMutantsInput, S.Union<readonly [typeof CheckFinished, typeof RetestRequired]>, S.Union<readonly [typeof DiagnosticWithoutFileError, typeof DiagnosticInUnrelatedFileError]>>;
export {};
