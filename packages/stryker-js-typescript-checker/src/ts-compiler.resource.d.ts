import type { Options } from '@systemfsoftware/stryker-js-plugin-interface';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import { type Pipeable } from 'effect/Pipeable';
import type * as Scope from 'effect/Scope';
import { type TSCompiler } from './ts-compiler.handle.js';
declare const TypeId: unique symbol;
export type TypeId = typeof TypeId;
export interface TSCompilerResource extends Pipeable {
    readonly [TypeId]: TypeId;
    readonly spec: Options.StrykerOptions;
    readonly scoped: Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path>;
    layer<Id>(service: Context.Key<Id, TSCompiler>): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>;
}
export declare const scoped: (options: Options.StrykerOptions) => Effect.Effect<TSCompiler, never, Scope.Scope | FileSystem.FileSystem | Path.Path>;
export declare const layer: {
    <Id>(service: Context.Key<Id, TSCompiler>): (options: Options.StrykerOptions) => Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>;
    <Id>(service: Context.Key<Id, TSCompiler>, options: Options.StrykerOptions): Layer.Layer<Id, never, FileSystem.FileSystem | Path.Path>;
};
export declare const make: (options: Options.StrykerOptions) => TSCompilerResource;
export {};
