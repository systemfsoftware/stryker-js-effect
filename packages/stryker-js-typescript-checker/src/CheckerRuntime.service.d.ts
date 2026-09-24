import { Checker, type Options } from '@systemfsoftware/stryker-js-plugin-interface';
import type * as Cause from 'effect/Cause';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
export interface CheckerRuntimeShape {
    readonly checker: Effect.Effect<Checker.Checker['Service'], Cause.Cause<Checker.CheckerFailed>>;
}
declare const CheckerRuntime_base: Context.ServiceClass<CheckerRuntime, "@systemfsoftware/stryker-js-typescript-checker/CheckerRuntime.service/CheckerRuntime", CheckerRuntimeShape>;
export declare class CheckerRuntime extends CheckerRuntime_base {
    static readonly layer: (options: Options.StrykerOptions) => Layer.Layer<CheckerRuntime, never, FileSystem.FileSystem | Path.Path>;
}
export {};
