import { Checker, type Options } from '@systemfsoftware/stryker-js-plugin-interface';
import * as Effect from 'effect/Effect';
import type * as FileSystem from 'effect/FileSystem';
import * as HashMap from 'effect/HashMap';
import * as MutableHashMap from 'effect/MutableHashMap';
import * as MutableHashSet from 'effect/MutableHashSet';
import type * as Path from 'effect/Path';
import { type Pipeable } from 'effect/Pipeable';
import * as Ref from 'effect/Ref';
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs';
import { API, type Diagnostic, type Snapshot } from 'typescript/unstable/sync';
import type { NodeDecodedShape } from './CheckMutants.schema.js';
import { type CompilerError, NodeNotInGraph } from './Compiler.schema.js';
import { type TSFiles } from './ts-files.handle.js';
export declare const TypeId: unique symbol;
export type TypeId = typeof TypeId;
declare const RuntimeTypeId: unique symbol;
type FileNode = NodeDecodedShape;
type GraphNodes = HashMap.HashMap<string, FileNode>;
type SourceFiles = MutableHashMap.MutableHashMap<string, {
    fileName: string;
    imports: MutableHashSet.MutableHashSet<string>;
}>;
interface CompilerState {
    api: API | undefined;
    snapshot: Snapshot | undefined;
    sourceFiles: SourceFiles;
    nodes: GraphNodes;
    lastMutants: Checker.CheckerMutantWire[];
    lastMutatedFileNames: string[];
    allTSConfigFiles: MutableHashSet.MutableHashSet<string>;
    tsconfigFile: string;
}
interface TSCompilerRuntime {
    readonly options: Options.StrykerOptions;
    readonly host: FileSystem.FileSystem;
    readonly pathService: Path.Path;
    readonly files: TSFiles;
    readonly sourceFileSystem: TSFileSystem;
    readonly state: Ref.Ref<CompilerState>;
}
export interface TSCompiler extends Pipeable {
    readonly [TypeId]: TypeId;
    readonly [RuntimeTypeId]: TSCompilerRuntime;
}
export declare const isTSCompiler: (u: unknown) => u is TSCompiler;
export declare const make: {
    (options: Options.StrykerOptions, services: {
        readonly host: FileSystem.FileSystem;
        readonly pathService: Path.Path;
    }): TSCompiler;
    (services: {
        readonly host: FileSystem.FileSystem;
        readonly pathService: Path.Path;
    }): (options: Options.StrykerOptions) => TSCompiler;
};
export declare const init: (self: TSCompiler) => Effect.Effect<readonly Diagnostic[], CompilerError>;
export declare const check: {
    (mutants: readonly Checker.CheckerMutantWire[]): (self: TSCompiler) => Effect.Effect<readonly Diagnostic[], CompilerError>;
    (self: TSCompiler, mutants: readonly Checker.CheckerMutantWire[]): Effect.Effect<readonly Diagnostic[], CompilerError>;
};
export declare const nodes: (self: TSCompiler) => Effect.Effect<GraphNodes, never, never>;
export declare const groups: {
    (mutants: readonly Checker.CheckerMutantWire[], prioritizePerformanceOverAccuracy: boolean): (self: TSCompiler) => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>;
    (self: TSCompiler, mutants: readonly Checker.CheckerMutantWire[], prioritizePerformanceOverAccuracy: boolean): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CompilerError | NodeNotInGraph>;
};
export declare const getLineAndCharacterOfPosition: {
    (fileName: string, position: number): (self: TSCompiler) => Effect.Effect<{
        line: number;
        character: number;
    } | undefined>;
    (self: TSCompiler, fileName: string, position: number): Effect.Effect<{
        line: number;
        character: number;
    } | undefined>;
};
export declare const close: (self: TSCompiler) => Effect.Effect<void>;
export {};
