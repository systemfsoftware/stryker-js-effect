import { Sandwich } from '@systemfsoftware/effect-cell-types';
import { Checker } from '@systemfsoftware/stryker-js-plugin-interface';
import * as Effect from 'effect/Effect';
import { CheckMutantsCommand } from './Checker.schema.js';
import { CheckMutantsInput } from './CheckMutants.schema.js';
import { TypeScriptCompiler } from './ts-compiler.service.js';
export type CheckMutantsRead = (typeof CheckMutantsInput)['Encoded'];
export declare const checkCell: Sandwich.WrittenFrom<CheckMutantsCommand, Checker.CheckerFailed, TypeScriptCompiler, import("effect/Schema").Union<readonly [typeof import("./check-mutants.workflow.js").CheckFinished, typeof import("./check-mutants.workflow.js").RetestRequired]>, {
    CheckFinished: (answer: {
        readonly _tag: "CheckFinished";
        readonly results: {
            readonly [x: string]: {
                readonly status: "passed";
            } | {
                readonly status: "compileError";
                readonly reason: string;
            };
        };
    }) => Effect.Effect<{
        readonly _tag: "CheckFinished";
        readonly results: {
            readonly [x: string]: {
                readonly status: "passed";
            } | {
                readonly status: "compileError";
                readonly reason: string;
            };
        };
    }, never, never>;
    RetestRequired: (answer: {
        readonly _tag: "RetestRequired";
        readonly results: {
            readonly [x: string]: {
                readonly status: "passed";
            } | {
                readonly status: "compileError";
                readonly reason: string;
            };
        };
        readonly needsRetest: readonly {
            readonly id: string;
            readonly fileName: string;
            readonly mutatorName: string;
            readonly replacement: string;
            readonly location: {
                readonly start: {
                    readonly line: number;
                    readonly column: number;
                };
                readonly end: {
                    readonly line: number;
                    readonly column: number;
                };
            };
        }[];
    }) => Effect.Effect<{
        readonly _tag: "RetestRequired";
        readonly results: {
            readonly [x: string]: {
                readonly status: "passed";
            } | {
                readonly status: "compileError";
                readonly reason: string;
            };
        };
        readonly needsRetest: readonly {
            readonly id: string;
            readonly fileName: string;
            readonly mutatorName: string;
            readonly replacement: string;
            readonly location: {
                readonly start: {
                    readonly line: number;
                    readonly column: number;
                };
                readonly end: {
                    readonly line: number;
                    readonly column: number;
                };
            };
        }[];
    }, never, never>;
    DiagnosticWithoutFileError: ({ text }: {
        readonly _tag: "DiagnosticWithoutFileError";
        readonly text: string;
    }) => Effect.Effect<never, Checker.CheckerFailed, never>;
    DiagnosticInUnrelatedFileError: ({ text, fileName }: {
        readonly _tag: "DiagnosticInUnrelatedFileError";
        readonly text: string;
        readonly fileName: string;
    }) => Effect.Effect<never, Checker.CheckerFailed, never>;
    CommandRejected: ({ issue }: Sandwich.CommandRejected) => Effect.Effect<never, Checker.CheckerFailed, never>;
}>;
