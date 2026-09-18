---
name: stryker-js-effect
last_updated: 2026-09-13
---

# stryker-js-effect Strategy

## Purpose

Upstream StrykerJS fails modern CI pipelines and AI-assisted development loops in three critical ways:

1. **Lost progress on cancel**: Terminating an in-flight mutation run discards all completed mutant results without producing a report, turning cancelled runs into wasted wall-clock time.
2. **Brittle incremental cache**: The `stryker-incremental.json` cache goes stale easily, forcing teams to fall back to slow, full-suite mutation runs.
3. **Black-box execution**: Upstream was built for human terminal observation via interactive TUIs, leaving automated pipelines and AI coding agents unable to monitor progress, estimate remaining work, or detect hanging runs.

## Positioning

**Machine-first streaming**. We treat automation runners, CI pipelines, and AI coding agents as primary consumers rather than terminal scrapers. Real-time line-delimited NDJSON events on `stdout` and structured exit codes are our contract; formatted human output is secondary.

## Users

**Primary:** Software engineers running mutation testing as an automated CI gate on high-assurance TypeScript and JavaScript codebases. They need reliable incremental runs and structured reports that never lose progress when jobs are cancelled.

**Secondary:** AI coding agents and automated testing loops. They require continuous, machine-readable NDJSON streaming to track mutation test progress, detect stalls, and act on exact mutant outcomes in real time.

## Boundaries

- **No TUI-only features**: Every feature, progress metric, and report must be fully accessible via structured NDJSON events.
- **No unverified incremental state**: Cache files must accurately represent completed mutants and survive aborted runs without corruption.
- **No Effect 3 backwards compatibility**: Effect 4 RC is the foundation across all packages.
- **Track upstream where practical**: Retain compatibility with standard Stryker config conventions while prioritizing pipeline reliability over interactive cosmetic parity.

_Resist a change when:_ it optimizes for interactive terminal aesthetics at the expense of structured streaming reliability or machine-readable contracts.

_Gate:_ review — ensure every CLI behavior and engine state change is represented in the NDJSON stream protocol and covered by automated integration checks.

## Key metrics

- **Streaming responsiveness**: Wall-clock duration from CLI invocation to the first `stream` NDJSON event emitted on `stdout`.
- **Incremental cache hit rate**: Percentage of eligible unchanged files successfully skipped across repeated mutation runs.
- **Partial report retention**: Verification that 100% of cancelled/interrupted runs successfully flush partial mutant reports to disk.
- **Package adoption**: Weekly install volume of `@systemfsoftware/stryker-js` and runner plugins across CI workflows.

## Tracks

### Real-Time Streaming & Partial Reports

Stream individual mutant evaluations to `stdout` as they complete and guarantee that partial reports are flushed when runs receive termination signals (`SIGINT`, `SIGTERM`).

_Why it serves the approach:_ Eliminates the black-box execution barrier for CI systems and coding agents while ensuring interrupted runs produce actionable diagnostic data.

### Robust Incremental State Engine

Redesign the incremental state store into a durable, crash-resilient format that safely captures mutant verdicts across both completed and aborted runs.

_Why it serves the approach:_ Makes mutation testing practical for large codebases by turning incremental execution into a trustworthy, always-on default.

### Modern Platform & Ecosystem Integration

Deliver zero-delay support for modern toolchains (TypeScript 7, Vitest, Node 22+) and native plugin ignorers for Effect Schema constructs.

_Why it serves the approach:_ Enables teams working on modern Effect-TS codebases to adopt mutation testing without encountering false-positive mutant noise on type-level contracts.

## Milestones

- **2026-10-01** — Stable Release of `@systemfsoftware/stryker-js` with verified partial report recovery and TypeScript 7 out-of-the-box support.
- **2026-11-15** — Resilient incremental cache engine landing across all workspace runner plugins.

## Brand

**One-liner:** Mutation testing built for machines, agents, and continuous delivery.

**Key message:** `@systemfsoftware/stryker-js-effect` replaces terminal scraping and brittle caching with real-time NDJSON streaming, resilient incremental state, and native Effect 4 architecture.
