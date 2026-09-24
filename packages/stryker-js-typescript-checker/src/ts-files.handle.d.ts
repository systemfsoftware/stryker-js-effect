import type { Checker } from '@systemfsoftware/stryker-js-plugin-interface';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import type * as FileSystem from 'effect/FileSystem';
import * as MutableHashMap from 'effect/MutableHashMap';
import * as Option from 'effect/Option';
import { type Pipeable } from 'effect/Pipeable';
import * as Ref from 'effect/Ref';
import type { FileSystem as TSFileSystem } from 'typescript/unstable/fs';
import { HybridFileNotFoundError } from './Compiler.schema.js';
export declare const TypeId: unique symbol;
export type TypeId = typeof TypeId;
declare const StateTypeId: unique symbol;
export interface ScriptFile {
    readonly fileName: string;
    readonly originalContent: string;
    readonly content: string;
    readonly modifiedTime: DateTime.Utc;
}
interface TSFilesState {
    readonly host: FileSystem.FileSystem;
    readonly files: Ref.Ref<MutableHashMap.MutableHashMap<string, Option.Option<ScriptFile>>>;
    readonly overrides: Ref.Ref<MutableHashMap.MutableHashMap<string, string>>;
}
export interface TSFiles extends Pipeable {
    readonly [TypeId]: TypeId;
    readonly [StateTypeId]: TSFilesState;
}
export declare const isTSFiles: (u: unknown) => u is TSFiles;
export declare const make: (host: FileSystem.FileSystem) => TSFiles;
export declare const getFile: {
    (fileName: string): (self: TSFiles) => Effect.Effect<Option.Option<ScriptFile>>;
    (self: TSFiles, fileName: string): Effect.Effect<Option.Option<ScriptFile>>;
};
export declare const mutateFile: {
    (fileName: string, mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>): (self: TSFiles) => Effect.Effect<void, HybridFileNotFoundError>;
    (self: TSFiles, fileName: string, mutant: Pick<Checker.CheckerMutantWire, 'location' | 'replacement'>): Effect.Effect<void, HybridFileNotFoundError>;
};
export declare const resetFile: {
    (fileName: string): (self: TSFiles) => Effect.Effect<void>;
    (self: TSFiles, fileName: string): Effect.Effect<void>;
};
export declare const setOverrides: {
    (overrides: MutableHashMap.MutableHashMap<string, string>): (self: TSFiles) => Effect.Effect<void>;
    (self: TSFiles, overrides: MutableHashMap.MutableHashMap<string, string>): Effect.Effect<void>;
};
export declare const tsFileSystem: (self: TSFiles) => TSFileSystem;
export {};
