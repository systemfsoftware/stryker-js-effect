/**
 * Compiler — declarations for the TypeScript compiler and version guard.
 *
 * The error vocabulary every compiler operation refuses with; decoded and
 * reported at the checker boundary, no I/O.
 */
import { Schema as S } from 'effect';
import { TsConfigNotFoundError, TsConfigParseError } from './Tsconfig.schema.js';
declare const UnsupportedTypeScriptVersionError_base: S.Class<UnsupportedTypeScriptVersionError, S.TaggedStruct<"UnsupportedTypeScriptVersionError", {
    readonly version: S.String;
}>, import("effect/Cause").YieldableError>;
/** The installed TypeScript version is below the supported floor. */
export declare class UnsupportedTypeScriptVersionError extends UnsupportedTypeScriptVersionError_base {
    get message(): string;
}
declare const HybridFileNotFoundError_base: S.Class<HybridFileNotFoundError, S.TaggedStruct<"HybridFileNotFoundError", {
    readonly fileName: S.String;
}>, import("effect/Cause").YieldableError>;
/** Requested file is not present in the hybrid in-memory file map. */
export declare class HybridFileNotFoundError extends HybridFileNotFoundError_base {
}
declare const CompilerFailed_base: S.Class<CompilerFailed, S.TaggedStruct<"CompilerFailed", {
    readonly reason: S.Literals<readonly ["not-initialized", "no-projects", "unknown-file-node", "file-not-in-project"]>;
    readonly subject: S.optional<S.String>;
}>, import("effect/Cause").YieldableError>;
/**
 * Every way the TypeScript compiler can fail while serving a check.
 * One tagged error — callers branch only on failure itself; `reason` keeps
 * cases distinguishable in reports.
 */
export declare class CompilerFailed extends CompilerFailed_base {
    get message(): string;
}
declare const DryRunCompileErrors_base: S.Class<DryRunCompileErrors, S.TaggedStruct<"DryRunCompileErrors", {
    readonly text: S.String;
}>, import("effect/Cause").YieldableError>;
export declare class DryRunCompileErrors extends DryRunCompileErrors_base {
    get message(): string;
}
declare const NodeNotInGraph_base: S.Class<NodeNotInGraph, S.TaggedStruct<"NodeNotInGraph", {
    readonly fileName: S.String;
}>, import("effect/Cause").YieldableError>;
export declare class NodeNotInGraph extends NodeNotInGraph_base {
    get message(): string;
}
export type CompilerError = CompilerFailed | UnsupportedTypeScriptVersionError | TsConfigNotFoundError | TsConfigParseError;
export {};
