/**
 * Tsconfig — declarations for the TypeScript configuration consumed by the checker.
 *
 * Typed by Effect Schema and decoded at the boundary; the compiler capability
 * consumes only validated shapes.
 */
import { Schema as S } from 'effect';
declare const TsConfigParseError_base: S.Class<TsConfigParseError, S.TaggedStruct<"TsConfigParseError", {
    readonly file: S.String;
    readonly reason: S.String;
}>, import("effect/Cause").YieldableError>;
/** The configured tsconfig failed to parse or is not a shape this package can consume. */
export declare class TsConfigParseError extends TsConfigParseError_base {
}
declare const TsConfigNotFoundError_base: S.Class<TsConfigNotFoundError, S.TaggedStruct<"TsConfigNotFoundError", {
    readonly file: S.String;
}>, import("effect/Cause").YieldableError>;
/** The configured tsconfig file could not be read. */
export declare class TsConfigNotFoundError extends TsConfigNotFoundError_base {
    get message(): string;
}
export declare const TsConfigSchema: S.Struct<{
    readonly references: S.optional<S.$Array<S.Struct<{
        readonly path: S.String;
    }>>>;
    readonly compilerOptions: S.optional<S.$Record<S.String, S.Unknown>>;
}>;
export type TsConfig = S.Schema.Type<typeof TsConfigSchema>;
export {};
