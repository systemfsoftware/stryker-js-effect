import * as S from 'effect/Schema';
export declare const TypescriptCheckerOptionsSchema: S.Struct<{
    readonly typescriptChecker: S.optional<S.Struct<{
        readonly prioritizePerformanceOverAccuracy: S.optional<S.Boolean>;
    }>>;
}>;
declare const CheckMutantsCommand_base: S.Class<CheckMutantsCommand, S.TaggedStruct<"CheckMutantsCommand", {
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
}>, {}>;
export declare class CheckMutantsCommand extends CheckMutantsCommand_base {
}
export {};
