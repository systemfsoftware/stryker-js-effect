# Review findings (raw) — 2026-10-10-0141-feat-agent-surfaces-plan.md

Non-interactive ce-doc-review, round 1, REPORT-ONLY: reviewers report, nothing is applied to the plan; the supervisor rules each finding. Team: coherence, feasibility, scope-guardian, adversarial. Raw reviewer JSON is appended as each reviewer returns.

## adversarial (RevAdversarial2)

```json
{
  "reviewer": "adversarial",
  "findings": [
    {
      "title": "No reason code exists for incrementally reused mutants",
      "severity": "P1",
      "section": "KTD2 — the `<code>: <detail>` statusReason grammar (Planning Contract, Key Technical Decisions)",
      "why_it_matters": "The `mutant` line U3 adds cannot encode for the largest population of a run. Incremental reuse is on by default (`incremental: true`), and every mutant taken from the prior report is materialized with the bare free-text placeholder `statusReason: 'Remembered'` (`run/incremental-reuse.cell.ts:421,446`), which is neither a closed code nor a conforming `code: detail` pair. Those reused results are exactly the set that produced the corpus's 1,035 survivors, so the decision of what they carry — a new `remembered` code, or a synthesized `covered-not-killed` from the remembered `coveredBy` — lands inside U2/U3 with no guidance, against a vocabulary KTD2 says is closed and shared by every surface.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "Add a `remembered` member to the KTD2 code table for statuses whose result is inherited rather than re-tested; state in U3 that `run/incremental-reuse.cell.ts` emits `remembered: <detail>` instead of the bare `Remembered` placeholder; and state in U2's verification that every existing producer of `statusReason` (raw runner error text, `wall-clock-timeout`, `Hit limit reached (n/m)`) now supplies the `detail` half, so the timeout-kind matchers keep matching on it.",
      "confidence": 75,
      "evidence": [
        "Settled statuses get a `<code>: <detail>` text grammar decoded to `{ code, detail }`, the same shape as `IgnoreStatusReasonText` (main `ignore-rule.schema.ts:44-52`), so `statusReason` is one field with one grammar for every status.",
        "| `Survived` | `covered-not-killed` (covering tests ran, none failed), `coverage-not-measured` (coverage analysis off) |",
        "Refusal: `covered-not-killed` with no `: ` separator, an unknown code `slow`, and a `Survived` code under `Ignored` are rejected (pack: schema-laws, refusals-beside-generated-laws.md)."
      ]
    },
    {
      "title": "Summary cursor cannot resolve against the only surviving report",
      "severity": "P1",
      "section": "R11 — the bounded default machine-output requirement (Product Contract, Requirements)",
      "why_it_matters": "An agent that follows the cursor printed in a run summary gets `cursor-stale` on its first page in the one environment where mutation actually runs. Shard runs write their report under `--out reports/shards/<slug>` (`mutation.yml:210`) while only the merged `reports/mutation` report is uploaded (`mutation.yml:296,301`); KTD7 binds the cursor to a digest of the report bytes, so a shard summary's cursor addresses a document no agent obtains, and even that document would hold only that shard's mutants rather than the 1,506 AE4 expects. KTD8 assumes paging happens after a merge, but the summary is written at run end, before any merge exists.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "State in KTD5, R11 and AE4 that a run emits a paging cursor only when it is unsharded and owns the report the cursor names; in a sharded run the summary carries that shard's own actionable count and names the merged report artifact plus the post-merge `stryker list --report <path>` command in place of a cursor.",
      "confidence": 75,
      "evidence": [
        "`page` (`Complete` or `More { total, cursor, command }`), `reportFile`, `streamFile`, then the existing fields.",
        "Cursor: base64url of `<first 12 hex of sha-256 of the report bytes>:<offset>`; a digest mismatch is the `cursor-stale` refusal.",
        "In CI only `reports/mutation/` is uploaded (`mutation.yml:298-303`) and shard streams are deleted, so `stryker list` and MCP read `mutation.json`; U4 lands before U5.",
        "shard jobs write a summary from their terminal event."
      ]
    },
    {
      "title": "Corpus budgets are measured on a pre-vocabulary report",
      "severity": "P1",
      "section": "Budgets on the corpus (Planning Contract, High-Level Technical Design)",
      "why_it_matters": "Every size figure the plan requires a layer to state is derived from a report that carries none of the fields the new encoder emits: artifact `mutation-report-416` holds 8,626 mutants with zero `statusReason` and zero `coveredBy`, and mutation reaches a corpus only through the released CLI, so a 7.0-shaped corpus report cannot exist until the human-approved release U12 already waits on. An implementer of U5, U6 or U7 will therefore run the new pager over a legacy-shaped report and record numbers that under-state the real payload by precisely the volume the plan itself sized (+172,032 B of `statusReason` across the corpus), so a real run can breach the 10,000-byte budget while every stated figure is green.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "Mark the Budgets table's Planned column as model-derived over the 3.9.0-shaped `mutation-report-416` and record that it excludes the `statusReason` and `next` payload; add to U12 a post-release re-measurement on the first main mutation run whose merged report carries 7.0 fields, stating actual summary, page and MCP-result bytes there and superseding the model figures.",
      "confidence": 75,
      "evidence": [
        "Planned sizes come from modelling the KTD3-KTD7 shapes over that report; each layer re-measures with its real encoder and states the figure in its PR.",
        "on `mutation-report-416`, `stryker list` pages count and max page bytes are stated in the PR (model: 42 pages, max under 10,000).",
        "`mutation.yml` runs the released CLI, so it adopts new CLI behaviour only after a release.",
        "**Execution profile:** twelve units shipped as one `gh stack` off `main` (PR table in KTD1); U12 waits for a human-approved release. Mutation never runs locally; target mutant ids come from main's CI reports."
      ]
    },
    {
      "title": "Paged query offers no way to select a subset",
      "severity": "P2",
      "section": "U5 — Actionable order, cursor, `stryker list` (Planning Contract, Implementation Units)",
      "why_it_matters": "As designed, one survivor question costs 42 CLI invocations or 94 MCP round trips, and an agent that wants the survivors of one file, one reason code, or one status has no way to ask for them: `stryker list` accepts only `--cursor` and `--report`, and `list_survivors` only a cursor. The team already judged per-file selection necessary when it built the surfacing caps (1 per line, 7 per file), but that selection is not exposed through the new query, so the agent walks the whole ordering or falls back to the raw artifact. Paging and selection are not alternatives to each other, and the plan implemented only the first half.",
      "finding_type": "omission",
      "autofix_class": "manual",
      "suggested_fix": "Extend R13's query with `--status`, `--reason` and `--file` filters on `stryker list` and the matching parameters on `list_survivors`, with the active filter encoded into the cursor digest so a filtered cursor cannot be replayed against an unfiltered listing.",
      "confidence": 75,
      "evidence": [
        "`stryker list [--cursor <c>] [--report <path>]` reads `reports/mutation/mutation.json`, emits one `page` line on stdout (machine and human mode alike), exits 0, or a `refused` event with `report-missing`, `report-unreadable`, or `cursor-stale` and exit 2.",
        "then its whole output is at most 10,000 bytes, begins with the verdict and its causes, and holds counts, a first page, the stream file path, and a cursor; the paging command's pages together list all 1,506.",
        "about 16 items per page, 94 pages"
      ]
    },
    {
      "title": "R19 passes without reducing log-failed cost",
      "severity": "P2",
      "section": "R19 — the leading-cause requirement (Product Contract, Requirements)",
      "why_it_matters": "The Success Criterion only asks the dispatch run to report its byte and line counts beside the 157,260-byte baseline; nothing requires those counts to fall. Emitting one early `##[error]` line satisfies R19 while the 1,472-line whole-job dump the agent actually pays for stays byte-identical — and the plan's own assumption record names the cause of that dump (step association reported as `UNKNOWN STEP`) as unverified with no restoration step. An implementer can complete U9's proof with a byte count equal to the baseline and a green check, which satisfies the document while leaving the wall it was written to remove.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "Give R19 and its Success Criterion a measured target — on the dispatch run the first `##[error]` line naming the cause appears within the first 20 lines of the failing step's log — and add the fallback: where step association still reports `UNKNOWN STEP`, the U9 dispatch evidence records that the whole-job line count is unchanged and names the job step summary as the supported entry point.",
      "confidence": 75,
      "evidence": [
        "`gh run view --log-failed` on the dispatch proof run reports its byte and line counts beside the 157,260-byte and 59,162-byte baselines, and its first `##[error]` line names the cause.",
        "Unverified: whether GitHub's `gh` step association can be restored for this repo's jobs; on #925 every line was `UNKNOWN STEP`, so `--log-failed` printed the whole job, including about 830 setup lines before the test step.",
        "`gh run view --log-failed` printed `UNKNOWN STEP` for every line on #925, so it dumps the whole job; R19 is judged on the dispatch output, and the annotations list is the short path."
      ]
    },
    {
      "title": "Omitted-annotation count ignores the job-level cap",
      "severity": "P3",
      "section": "R18 — annotation severity, caps and overflow accounting (Product Contract, Requirements)",
      "why_it_matters": "The `499 were omitted` figure counts only against GitHub's 10-per-step ceiling, while the plan's own assumptions record the 50-per-Checks-request job ceiling as unverified and never resolve it. If that ceiling applies, a job whose failures span several steps loses the tail of each step's highest-priority ten, and the summary's omitted count — the number an agent uses to decide whether downloading the artifact is worth it — understates what GitHub actually dropped.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "Define R18's omitted count as the difference between the actionable set and the annotations the run actually emitted, and record GitHub's job-level annotation ceiling in the plan's Assumptions beside the existing unverified note.",
      "confidence": 50,
      "evidence": [
        "Unverified: whether the \"50 annotations per job\" figure applies; GitHub documents 50 per Checks API request.",
        "The step summary states how many were omitted and names the artifact holding the rest.",
        "then 10 `::error` annotations appear, highest priority first, each with `file` and `line`, and the step summary states that 499 were omitted and names the artifact holding them"
      ]
    }
  ],
  "residual_risks": [
    "KTD2 places nine CLI- and MCP-internal refusal codes (`report-missing`, `cursor-stale`, `rerun-refused`, and the run-failure set) in the published `stryker-js-plugin-interface`, which KTD14 then bumps. Plugin authors inherit a stable API surface for concepts internal to the CLI, and relocating them later needs a deprecation cycle rather than a move.",
    "The ~100-byte covering-test name drives every page, summary and stream figure in the Budgets table, and the corpus records no covering tests at all, so one unmeasured constant carries the whole sizing argument.",
    "Machine-mode stderr is assumed to stay under 2,000 B on a corpus-sized run and its measurement is deferred to U12, which runs the released CLI — so the 8,000/2,000 split in KTD5 is unverified until after a human release.",
    "The cursor digest is bound to report bytes; any consumer that re-serializes or re-merges the report before paging (rather than downloading the uploaded artifact) will see every cursor it received rejected as `cursor-stale`."
  ],
  "deferred_questions": [
    "What is the shape and import path of the mutant-quality workstream's vocabulary module? KTD2 assumes it lands beside `IgnoreRuleId` on the same path; if it lands elsewhere or with a different code spelling, the shared-vocabulary decision (KD2/KTD12) needs rework that no unit currently owns.",
    "Who chases OQ3 (the human-approved release and `stryker-published` pin move), and is the unit allowed to close before U12's AE6/AE8 evidence exists on a main mutation run? The Goal Capsule claims CI proves the surfaces on every change, which cannot hold for the mutation lane until that release lands."
  ]
}
```

## scope-guardian (RevScope2)

```json
{
  "reviewer": "scope-guardian",
  "findings": [
    {
      "title": "Journeys may never gate; OQ6 left unowned",
      "severity": "P2",
      "section": "U10 — Agent journeys (with OQ6 in Planning Contract → Open Questions)",
      "why_it_matters": "The unit's headline proof — 'CI proves this on every change' — rests on the agent journeys J1 and J2 running in the `e2e` lane, yet the plan records that lane's status context as unverified and picks 'inform but do not gate' as the fallback. No unit among the twelve resolves OQ6, so the stack can merge with the journeys never gating while every visible signal stays green; the repo's own `docs/solutions/workflow-issues/matrix-legs-rename-the-required-status-check.md` documents that a context nobody requires fails nothing. Naming OQ6's owner and requiring the answer before U10 is authored converts the proof claim from an assumption into a checkable fact, which is why the fix belongs in the plan rather than left to the implementer.",
      "autofix_class": "gated_auto",
      "finding_type": "omission",
      "suggested_fix": "Move OQ6 out of the unowned open list: before U10 is authored, read the repository's required-check list (`gh api repos/systemfsoftware/stryker-js-effect/branches/main/protection`), replace the Assumptions line with the measured answer, and name the branch-protection owner as the party who resolves it when the e2e contexts are not required.",
      "confidence": 75,
      "evidence": [
        "- The `e2e` job is a required status check (OQ6); if not, J1 and J2 inform but do not gate.",
        "- OQ6. **Required checks.** Whether `e2e` is a required status context (unverified; branch protection not read).",
        "**Objective:** A coding agent learns what a mutation run, CLI call, MCP call, report, or CI job concluded ... CI proves this on every change."
      ]
    },
    {
      "title": "U8 commits the SARIF work KD13 left conditional",
      "severity": "P3",
      "section": "U8 — Annotate levels, limit, failures; SARIF rule text",
      "why_it_matters": "KD13, the settled SARIF decision, authorizes the rule text and truncation note 'only if cheap', but U8 converts that condition into committed scope with two test scenarios and ten named target mutants on `sarif-report.workflow.ts` — for an output no workflow reads (code-scanning upload is out of scope) and whose value the plan itself lists as unverified. An implementer following U8 has no step at which KD13's cheapness test applies, so a decision the user settled gets made by the unit list instead. Tying U8's SARIF half to the U1 audit row (the deliverable R1 already asks for) restores the condition KD13 already wrote, at no cost to the annotation work U8 exists to ship.",
      "autofix_class": "gated_auto",
      "finding_type": "error",
      "suggested_fix": "In U8, make the SARIF half contingent on U1's audit row: the `fullDescription`/`help` rules and the `run.properties` truncation note land only when that row records their cost and the reader that consumes them, and otherwise move to Scope Boundaries as considered-and-not-built; move U8's two SARIF test scenarios and the `sarif-report.workflow.ts` target mutants under that same condition.",
      "confidence": 50,
      "evidence": [
        "- KD13. **SARIF upload to code scanning is out of scope.** SARIF is audited; rule help, `fullDescription`, and an explicit truncation note are added only if cheap. Governs R1.",
        "SARIF rules gain `fullDescription` and `help` from the vocabulary annotations, and the run notes truncation past `SARIF_MAX_RESULTS` in `run.properties`.",
        "- Unverified: whether GitHub ingests SARIF rules lacking `fullDescription` and `help`."
      ]
    },
    {
      "title": "U11's guide waits on U10, which changes no contract",
      "severity": "P3",
      "section": "U11 — Generated agent guide (and the KTD1 stack table)",
      "why_it_matters": "The generated agent guide is the one surface that answers the objective's 'from documented schema fields alone', and U11 declares its dependency as U10 'final vocabulary and shapes' — but U10's file list holds only journey tests and the consumer selector, so every shape the guide renders (event kinds, reason codes, next actions, the 10,000/8,000/4,800-byte budgets, paging) is already fixed after U8. Depending on U8 instead lands the guide, the `AGENTS.md` pointer, and the skill pointer one PR earlier on identical inputs, and the ordering change is the whole fix.",
      "autofix_class": "gated_auto",
      "finding_type": "error",
      "suggested_fix": "Change U11's declared dependency from U10 to U8, and swap the two rows in the KTD1 stack table so U11 is PR 10 (base PR 9) and U10 is PR 11 (base PR 10).",
      "confidence": 50,
      "evidence": [
        "- **Dependencies:** U10 (final vocabulary and shapes).",
        "| 11 | U11 | PR 10 | generated agent guide, doc pointers, README check |",
        "- **Files:** `test/e2e/tests/agent-journey-survivor.e2e.test.ts` (J1), `test/e2e/tests/agent-journey-run-failure.e2e.test.ts` (J2), `packages/stryker-js/tests/agent-journey-mcp.integration.test.ts` (J3), `packages/stryker-js/tests/agent-journey-merge-failure.integration.test.ts` (J4); `test/e2e/src/agent-consumer/*`"
      ]
    },
    {
      "title": "J4 repeats AE3 coverage with a fourth sabotage run",
      "severity": "P3",
      "section": "U10 — Agent journeys",
      "why_it_matters": "R23 names two journeys — one seeded survivor, one seeded failure — which J1 and J2 deliver, and AE3's merge-failure contract is already asserted by U4 in `tests/shard-merge.integration.test.ts` with the same hand-written `shard-reports-missing` reason and `rerun-shards` expectation. J4 adds a fourth integration test file, a selector case, and — because R25 requires one recorded sabotage run per journey — a fourth pushed commit with its red CI run, all re-proving AE3 through a harness U4 already exercises. Dropping J4 leaves the survivor, failure, and MCP journeys and keeps one proven route per acceptance example.",
      "autofix_class": "gated_auto",
      "finding_type": "error",
      "suggested_fix": "Remove J4 (`packages/stryker-js/tests/agent-journey-merge-failure.integration.test.ts`) and its sabotage from U10, and cite U4's `tests/shard-merge.integration.test.ts` scenario as the AE3 proof on U10's Requirements line.",
      "confidence": 50,
      "evidence": [
        "- R23. One journey takes a seeded survivor and one a seeded failure, and each selects its next action from reason code and fields alone.",
        "- Covers AE3. Extend `tests/shard-merge.integration.test.ts`: plan with two shards, one report directory absent: exit code 2, `error` event `reason: 'shard-reports-missing'`, detail lists the planned ids, `next: rerun-shards` naming the shard; hand-written expectation.",
        "- R25. Each journey has one recorded sabotage run that removes or corrupts a field it depends on and turns it red; the sabotage evidence goes in the PR body."
      ]
    }
  ],
  "residual_risks": [
    "The journeys' gating turns on status contexts the `ci.yml` matrix reports as `e2e (1/2)` and `e2e (2/2)`, and branch protection binds to those exact strings; even a positive OQ6 answer has to name the leg context, and J1/J2 land in one shard's file split rather than both.",
    "Every planned byte figure (36 items per CLI page, ~16 per MCP page, 945 B of fixed summary fields, 8,000 B cap) is a model over `mutation-report-416`, and the covering-test-name average of 100 bytes is an explicit assumption the first U4 report replaces; if real names are far longer, page counts and the summary packing move materially."
  ],
  "deferred_questions": [
    "For OQ6: who owns the required-check list for this repository, and at which unit must the answer be in hand — the plan fixes the unit order but never the point at which this assumption must become a fact."
  ]
}
```

## feasibility (RevFeasibility2)

```json
{
  "reviewer": "feasibility",
  "findings": [
    {
      "title": "U4 merge copies killedBy/coveredBy no stream line carries",
      "severity": "P2",
      "section": "U4 — Merge keeps facts; merge failures classified",
      "why_it_matters": "Implementers writing the merge cannot source two of the three fields U4 tells them to copy: the merged CI report will silently lose the killing test (and the covering-test list under the wrong name), so an agent reading a CI merge gets different facts than one reading a local run — the parity R9 exists to create. Merge rebuilds reports from the shard stream lines, and by KTD3 no line variant carries `killedBy` at all, while the covering field is named `coveringTests` there, not `coveredBy` (the MCP detail schema already uses `coveringTests`). Adding the field after U4/U5 ship means editing a lower layer of the same stack.",
      "finding_type": "error",
      "autofix_class": "gated_auto",
      "suggested_fix": "Add `killedBy` to the `Killed` variant of the KTD3 stream line (and to `mutant-detail`), and use KTD3's `coveringTests` name everywhere U4 says `coveredBy`; alternatively drop `killedBy` from U4's copy list and state that merged reports carry no killing test.",
      "confidence": 75,
      "evidence": [
        "`report-from-stream` copies `statusReason`, `coveredBy`, `killedBy` from the `7.0` lines and reads file sources from the checkout under `basePath`",
        "All variants: `id`, `fileName`, `location` (start and end), `mutator`, `replacement`, `status`, `statusReason`, `static`, `cost`. `Survived`, `Timeout`, `RuntimeError` add `original`, `coveringTests`, `next`; `NoCoverage` adds `original` and `next`; `Killed`, `CompileError`, `Ignored` add nothing.",
        "In CI only `reports/mutation/*` is uploaded (`mutation.yml:298-303`) and shard streams are deleted, so `stryker list` and MCP read `mutation.json`; U4 lands before U5."
      ]
    },
    {
      "title": "show_mutant has no size bound against R14",
      "severity": "P2",
      "section": "U7 — MCP paging, drill-down, structured refusals",
      "why_it_matters": "An agent calling `show_mutant` on a heavily covered survivor can receive a result over the 10,000-byte budget, which is exactly the truncation KD5 exists to prevent, because R14 bounds every MCP result while the drill-down deliberately returns the full covering-test list plus the reproducer diff and neither appears in the Budgets table. U7's tests only assert paging for `list_survivors` and an unknown-id refusal for `show_mutant`, so the violation can ship green; the plan itself records covering-test list sizes as unmeasured.",
      "finding_type": "omission",
      "autofix_class": "gated_auto",
      "suggested_fix": "State a bound for `show_mutant`: return at most three covering-test names plus the total (the full list stays in the stream file's `mutant-detail`) and cap or omit the diff, and add a `show_mutant` row to the Budgets on the corpus table with its modelled bytes.",
      "confidence": 75,
      "evidence": [
        "Every MCP tool result fits the R11 budget counting both its `structuredContent` and the serialized-JSON text block the spec recommends; `list_survivors` pages instead of returning the whole surfaced set.",
        "`shown` holds at most three test names; `total` is the full count; the drill-down lists all (Q5).",
        "`mutant-detail` (`run-event.schema.ts:300`) gains the same fields with the full covering-test list.",
        "Covering-test names average about 100 bytes; the merged report records none today, so the first U4 report replaces this figure."
      ]
    },
    {
      "title": "U5 needs the refused reshape KTD5 assigns to U6",
      "severity": "P2",
      "section": "U5 — Actionable order, cursor, stryker list",
      "why_it_matters": "U5 must emit a `refused` event carrying a tool-refusal reason and a `next` action, but KTD5 gives that contract change to U6, which lands one PR later on top of U5; an implementer following KTD1's order either duplicates the contract edit inside U5 or ships a `stryker list` that cannot express `cursor-stale`, breaking KTD1's promise that every layer is green and inert on its own. U5's listed dependency is U4 only, and its own test asserts the `next` field.",
      "finding_type": "error",
      "autofix_class": "gated_auto",
      "suggested_fix": "Assign the `Refused` reshape (`reason` plus `next`) to U5 alongside the new `page` event, leaving U6 the `verdict`/`error` reshape alone.",
      "confidence": 75,
      "evidence": [
        "emits one `page` line on stdout (machine and human mode alike), exits 0, or a `refused` event with `report-missing`, `report-unreadable`, or `cursor-stale` and exit 2",
        "Edge: a cursor from a different report digest returns `cursor-stale` with `next: restart-paging`.",
        "`RunFailed` and `Refused` gain `reason` and `next`."
      ]
    },
    {
      "title": "original sourced from the instrumented source is wrong",
      "severity": "P3",
      "section": "U3 — Stream 7.0 mutant variants and next actions",
      "why_it_matters": "The run's sandbox source already has this mutant's replacement applied and offsets after it shifted, so slicing it at the mutant's original location does not yield the original text (the codebase slices the pre-instrumentation `file.source` for the same purpose in `build-reproducers.workflow.ts:106-107`). An agent reading `original` would be shown the mutation as its own input, defeating the field's purpose and failing AE1's hand-written `n * 2` expectation.",
      "finding_type": "error",
      "autofix_class": "gated_auto",
      "suggested_fix": "State that `original` is sliced from the pre-instrumentation file content the run holds (`Project` file `source`), the same value the reproducer builder uses, not from the instrumented source.",
      "confidence": 50,
      "evidence": [
        "`original` is sliced from the instrumented source the run already holds; covering tests come from the coverage the runner already reports per mutant."
      ]
    },
    {
      "title": "U12 annotate level expression is not valid GitHub syntax",
      "severity": "P3",
      "section": "U12 — mutation.yml adopts the released surfaces",
      "why_it_matters": "`gate failed` is not a GitHub expression operand, so the workflow step fails at evaluation instead of choosing a level, and the dispatch proof cannot produce the annotations U12's verification claims. The expression needs a real context path such as the gate step's outcome, which the plan does not name.",
      "finding_type": "error",
      "autofix_class": "gated_auto",
      "suggested_fix": "Write the level as `${{ steps.gate.outcome == 'failure' && 'error' || 'warning' }}`, naming the gate step that produces the outcome.",
      "confidence": 75,
      "evidence": [
        "report job: `stryker annotate --level ${{ gate failed && 'error' || 'warning' }} --limit 10 --summary \"$GITHUB_STEP_SUMMARY\"`"
      ]
    },
    {
      "title": "J1 expectation truncates the covering test name",
      "severity": "P3",
      "section": "U10 — Agent journeys",
      "why_it_matters": "R24 fails a journey when its decoded value differs from the hand-written expectation, and the fixture's actual test name carries a suffix (`double is called but never pinned — its mutants are this fixture's survivors`), so the expectation as written cannot be satisfied by a correct implementation. The same truncated string is repeated in U3's test scenario, so the fix has to land in both places.",
      "finding_type": "error",
      "autofix_class": "safe_auto",
      "suggested_fix": "Use the fixture's full test name from `test/e2e/testResources/calc-fixture/src/calc.test.ts:14` in both U3's test scenario and U10's J1 description.",
      "confidence": 75,
      "evidence": [
        "J1: calc-fixture survivor, default machine output, then `stryker list` page, expected `strengthen-tests` naming `double is called but never pinned`.",
        "hand-written expectation `{ status: 'Survived', reason: 'covered-not-killed', next: strengthen-tests }` with test `double is called but never pinned` and original `n * 2`"
      ]
    }
  ],
  "residual_risks": [
    "R11's stderr half is measured only on the U12 dispatch, after U6 ships in a human-approved release; if machine-mode logger output exceeds the 2,000-byte allowance, the stated fallback (routing logger output to the stream file) becomes a follow-up release rather than part of the stack.",
    "U12 waits for a release containing U5/U6/U8, but mutation.yml's report job runs `$PUBLISHED_CLI merge`, so R9's claim that CI-produced reports carry the same facts as local ones stays unproven until a release also carries U3 and U4.",
    "Every size in the budget model rests on the assumed ~100-byte covering-test average; the corpus report records no `coveredBy`, so the first U4 report can move the summary `top`, page, and MCP figures the plan's acceptance examples quote."
  ],
  "deferred_questions": [
    "Does the release U12 waits on include U3 (stream `7.0` variants) and U4 (merge-kept facts), or does the plan accept that CI's merged reports carry no reasons until a later release? KTD1's U12 row and OQ3 name only U5, U6, and U8."
  ]
}
```

## coherence (RevCoherence3)

```json
{
  "deferred_questions": [
    "Is OQ5 (limiting the main-only cache guard to mutation.yml) still open, given KTD12 already decided the ci.yml split? If a root answer changes it, R21's guard clause and KTD12 both need the same amendment, and this review's recommended fix assumes the KTD12 outcome holds.",
    "Who is the 'strategy owner' named in OQ4, and in which stack layer does the STRATEGY.md positioning rewording land relative to the R30 changeset? The recommendation here places it in U11 (generated-guide and doc-pointer unit); if the strategy owner works outside this stack, U11 needs to depend on that rewording instead."
  ],
  "findings": [
    {
      "autofix_class": "safe_auto",
      "confidence": 100,
      "evidence": [
        "| R4-R6, R8 | U2, U3 |",
        "| R7 | U2, U4, U6 |",
        "**Requirements:** R10, R11, R12, R30; AE4.",
        "**Requirements:** R5, R7, R8, R33.",
        "Stream and report fields stay unchanged in this layer.",
        "`RunFailed` and `Refused` gain `reason` and `next`.",
        "**Goal:** the merged CI report carries reasons, covering and killing tests, and sources"
      ],
      "finding_type": "error",
      "section": "Requirements Traceability (the unit-to-requirement mapping table in the Planning Contract)",
      "severity": "P2",
      "suggested_fix": "Add R7 to U6's Requirements line; narrow the traceability row to `R4-R6 | U3`, `R5, R8 | U2, U3`, and add U4 to R4's units so the merged-report facet of R4 is mapped.",
      "title": "Traceability table contradicts units' own requirement lines",
      "why_it_matters": "Reviewers and implementers closing out a layer will disagree about who owns work: the Requirements Traceability table credits U6 (summary-first default output) with R7 (the rule that every run-level failure carries a reason code, remediation, and a naming exit class) while U6's own `Requirements:` line omits R7, even though U6's Approach says it gives `RunFailed` and `Refused` their `reason` and `next` fields. The same table credits U2 (the reason vocabulary) with R4 (field set: location, original text, covering tests) and R6 (concrete next actions), yet U2 states outright that stream and report fields stay unchanged in this layer, and it defines no next-action members (KTD4 places those in U3). R4's merged-report facet lands in U4 under R9, but U4 is absent from R4's row. The alternative reading — that U2 pre-declares the vocabulary that R4/R6's fields consume — is a ghost: code members belong to R5, which U2 already claims, while R4 and R6 are field-set and next-action work. Fix by making the table follow the units' Approach text, which is the more specific authority in each case."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 100,
      "evidence": [
        "KD13. **SARIF upload to code scanning is out of scope.** SARIF is audited; rule help, `fullDescription`, and an explicit truncation note are added only if cheap.",
        "SARIF rules gain `fullDescription` and `help` from the vocabulary annotations, and the run notes truncation past `SARIF_MAX_RESULTS` in `run.properties`.",
        "**Requirements:** R18; AE6, AE8; KD13 (SARIF part).",
        "- R1. An audit document under `docs/` holds one row per surface in the Existing Surfaces table, recording from main's code: schema and version, whether every failure and survivor carries a stable reason code and a concrete next action"
      ],
      "finding_type": "error",
      "section": "KD13 (SARIF upload out of scope) vs U8 - Annotate levels, limit, failures; SARIF rule text",
      "severity": "P2",
      "suggested_fix": "Resolve the conditional: state in KD13 that rule help, `fullDescription`, and the explicit truncation note ship in U8 as committed scope, and add a Requirements Traceability row `SARIF rule text and truncation note | U8 (under KD13)` so the work has a completion-contract entry.",
      "title": "SARIF rule text committed in U8, conditioned in KD13, unowned by any requirement",
      "why_it_matters": "Two careful readers of U8 (the annotate-limits unit) reach opposite conclusions about whether the SARIF work is in scope: KD13, the Key Decision governing SARIF, says the rule help, `fullDescription`, and truncation note are added \"only if cheap\", while U8's Approach states them as unconditional deliverables with a test scenario asserting a non-empty `fullDescription.text` and `truncated: true`. The plan never resolves \"cheap\", so the SARIF half of U8 can be dropped or shipped without anyone deciding, and no requirement owns it at all: R1 is audit-only, the traceability table has no SARIF row, and U8 cites only `KD13 (SARIF part)`, which is an out-of-scope decision rather than an obligation. Because the vocabulary annotations come from U2, skipping or deferring this also silently drops the annotation text U11's generated guide reads."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 100,
      "evidence": [
        "every cache save, artifact deletion, and publish step runs only on `refs/heads/main`, so a branch dispatch cannot touch shared state.",
        "OQ5. **`ci.yml` cache-save guard cost.** Applying the ruling to `ci.yml` stops PR runs saving their own turbo cache; they still restore `main`'s. Confirm or limit the guard to `mutation.yml`.",
        "`ci.yml`'s combined `actions/cache` (`:37-41`) splits into a restore and a main-only save."
      ],
      "finding_type": "error",
      "section": "R21 (branch-dispatch guards) vs OQ5 `ci.yml` cache-save guard cost",
      "severity": "P2",
      "suggested_fix": "Rewrite R21's guard clause to name the steps that exist — the four mutation.yml steps KTD12 lists plus ci.yml's cache save — and drop the `publish step` clause (release.yml has no publish step in this repo). Move OQ5 out of Open Questions into a note under KTD12 recording it as resolved by the ci.yml restore/save split.",
      "title": "R21's guard clause is contested by OQ5 and settled differently by KTD12",
      "why_it_matters": "The plan states one guard rule and simultaneously offers to narrow it, so an implementer cannot tell whether ci.yml's cache save gets the `refs/heads/main` guard. R21 asserts that \"every cache save, artifact deletion, and publish step runs only on `refs/heads/main`\", KTD12 already decided the ci.yml implementation (\"splits into a restore and a main-only save\"), and OQ5 reopens the same decision (\"Confirm or limit the guard to `mutation.yml`\"). The three cannot all stand: a requirement that is also an open question is not a settled contract, and U9's dispatch proof only checks that guarded steps skip on `mutation.yml`, so choosing the narrow reading silently ships an unguarded ci.yml cache save with no verification. R21's clause also names a \"publish step\" that does not exist in the three workflows it governs (`ci.yml`, `mutation.yml`, `release.yml` — release.yml states outright \"There is no npm publish\"), so that part of the requirement is vacuous as written."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 75,
      "evidence": [
        "OQ4. **`STRATEGY.md:18` positioning.** It promises real-time NDJSON on stdout; KD5 makes that opt-in. The strategy owner rewords it.",
        "Changing the HTML report, prose-only docs without schema checks, tests that re-read a schema to find fields just added, assertions on human-pretty output, and LLM-judged evals.",
        "**Files:** `packages/stryker-js-cli-contract/scripts/contract-documents.ts` (`agentGuideSource()`), `scripts/generate-contract.ts`, `contract/agent-guide.md`, `tests/contract-documents.integration.test.ts`, package `README.md` pointer; root `AGENTS.md` (one pointer row), `skills/stryker-mutation-testing/SKILL.md` (pointer, removing restated stream facts); root `README.md` NDJSON sample; the README-sample decode test and its `turbo.json` input."
      ],
      "finding_type": "omission",
      "section": "OQ4 `STRATEGY.md:18` positioning vs Scope Boundaries prose-doc exclusion",
      "severity": "P2",
      "suggested_fix": "Add `STRATEGY.md` (positioning sentence only) to U11's Files and requirement line, and narrow the Scope Boundaries bullet to exclude prose-only docs other than the ones this plan is required to update.",
      "title": "No unit owns the STRATEGY.md rewording KD5 requires",
      "why_it_matters": "The stack ships a breaking change to stdout (R12 makes the full NDJSON stream opt-in under R30) while the committed strategy document still promises the opposite, and the plan assigns the fix to \"the strategy owner\" outside any unit. Two readers diverge on whether the edit happens at all: a reader following the Scope Boundaries will skip it (\"prose-only docs without schema checks\" are out of scope), and a reader following OQ4 will expect it in some layer. No unit's Files list contains STRATEGY.md — U11, the doc-pointer unit that already rewrites AGENTS.md, the skill, and the README, does not mention it — so the reword lands after merge or never, and the next planning cycle inherits a strategy doc that contradicts the shipped contract. The plan already owns the sibling doc rewrites (R27, R28), so the fix belongs in the same unit rather than with an unnamed external owner."
    },
    {
      "autofix_class": "safe_auto",
      "confidence": 75,
      "evidence": [
        "| U3 | Stream `7.0` mutant variants and next actions | contract `run-event.schema.ts`, `stream-version.schema.ts`, `next-action.schema.ts`, `run/mutant-run.ts`, `run/mutant-settlement.ts`, `Rerun/rerun-selection.ts` | U2 |",
        "| U8 | Annotate levels, limit, failures; SARIF rule text | `render-annotations.workflow.ts`, `sarif-report.workflow.ts` | U6 |",
        "`packages/stryker-js/src/run/mutant-run.ts`, `run/mutant-settlement.ts`, `Rerun/rerun-selection.ts`, `build-reproducers.workflow.ts`",
        "**Target mutants:** `build-reproducers.workflow.ts` survivors `e65ee3e59dbf8148` L13",
        "`Packages/stryker-js/src/Cli.schema.ts` (`annotate`: `--level error|warning`, `--limit`, `--summary <path>`, `--from-event <stream>`), `bin/cli-command.ts`"
      ],
      "finding_type": "error",
      "section": "Implementation Units index table (the 'Files touched (main)' column)",
      "severity": "P2",
      "suggested_fix": "Add `build-reproducers.workflow.ts` to the U3 row and `Cli.schema.ts`, `bin/cli-command.ts` to the U8 row in the Implementation Units index table, copying the paths from each unit's own Files line.",
      "title": "Files-touched index omits files its units edit",
      "why_it_matters": "Anyone scoping a layer from the Implementation Units index — which is the quick-read map, and the only place base and dependencies appear at a glance — will under-scope two layers. U3's row omits `build-reproducers.workflow.ts`, yet U3's Files line includes it, KTD4 reuses the reproducer string from that file, and U3's target-mutant list names 16 of its survivors; U8's row omits `Cli.schema.ts` and `bin/cli-command.ts`, yet U8's Files line adds four new CLI flags (`--level`, `--limit`, `--summary`, `--from-event`) that cannot exist without them. The rejected reading — that the column is a curated \"main files\" shortlist — does not hold up, because the column also carries no such label and omits the same kind of files other rows do include. Each unit's Files line is the more detailed authority, so the index should follow it."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 75,
      "evidence": [
        "Pages pack whole items until the next would cross the cap: 10,000 bytes for a CLI page, 4,800 bytes of structured content for an MCP result so both blocks stay under 10,000.",
        "- R13. One paged query over a finished run returns actionable items in a stable order with a cursor, each page within the R11 budget",
        "A pure builder caps the encoded summary at 8,000 bytes, leaving 2,000 bytes of the R11 budget for stderr.",
        "| `stryker list` page | no paging | 10,000 B | 36 items per page on average, 42 pages for 1,506 items"
      ],
      "finding_type": "error",
      "section": "KTD7 (one pure order, one cursor, byte-packed pages) vs R11 and R13 budgets",
      "severity": "P2",
      "suggested_fix": "Cap CLI pages at 8,000 bytes of stdout in KTD7 (leaving R11's 2,000-byte stderr headroom, as KTD5 already does for the summary), restate R13 as 'each CLI page within 8,000 bytes of stdout', and update the modelled figures in the Budgets table and U5's verification line to the recomputed items-per-page and page counts.",
      "title": "CLI pages get the whole budget the joint budget reserves for stderr",
      "why_it_matters": "The plan applies headroom discipline to the summary but not to paged output, so a page can land exactly on the client limit that motivated the whole unit. KTD7 gives a CLI page the full 10,000 bytes while KTD5 deliberately caps the terminal summary at 8,000 \"leaving 2,000 bytes of the R11 budget for stderr\" — and R11 (the budget R13 tells pages to stay within) measures \"stdout and stderr together\". Under KD4, Codex truncates tool output at 10,000 bytes, so a page packed to that cap is truncated the moment any logger line accompanies it, which is precisely the failure the 8,000-byte summary cap exists to prevent. Two careful implementers will build different packers (one honouring the stated 10,000 cap, one reserving stderr headroom), and the Budgets table's modelled figures (36 items per page, 42 pages) are tied to whichever cap is chosen."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 75,
      "evidence": [
        "`gh run view --log-failed` on the dispatch proof run reports its byte and line counts beside the 157,260-byte and 59,162-byte baselines, and its first `##[error]` line names the cause.",
        "On mutation run #413 the cause sits at line 467 of 523 and prints as `exit 1 (VerdictFail)` although no score was computed: shard reports were missing.",
        "Verified: corpus sizes and log sizes in the Problem Frame (artifact `mutation-report-416`, run 37960922409; `--log-failed` on runs 37953877772 and 37942966476)."
      ],
      "finding_type": "omission",
      "section": "Success Criteria (baseline bytes) and Problem Frame run #413 measurement",
      "severity": "P3",
      "suggested_fix": "Add the #413 `--log-failed` byte and line counts to the Problem Frame's run #413 sentence, defined the same way as the #925 figure (bytes of `--log-failed` output), so Success Criteria and U12's dispatch proof cite a sourced, defined baseline.",
      "title": "#413 byte baseline is asserted but never measured",
      "why_it_matters": "The 59,162-byte baseline that U12's dispatch proof is judged against has no source anywhere in the document, and its measurement definition is unstated. The Problem Frame records only \"line 467 of 523\" for mutation run #413, and the Dependencies section claims the log sizes were verified \"in the Problem Frame\" for runs 37953877772 (#925) and 37942966476 (#413) — but only #925's 157,260 bytes actually appear there. Without a definition, an implementer cannot tell whether 59,162 is the full job log, the `--log-failed` output, or the artifact, so U12's recorded comparison either cannot be produced or is produced against a different measurement than the #925 one, which R2's own sourcing discipline (audit rows must \"name the corpus artifact and run id each size comes from\") requires."
    },
    {
      "autofix_class": "safe_auto",
      "confidence": 100,
      "evidence": [
        "origin: docs/brainstorms/2026-10-10-0002-feat-agent-surfaces-plan.md",
        "The brainstorm file under `docs/brainstorms/` is deleted in this PR; this plan carries its Product Contract.",
        "**Verification:** every gap row names a requirement or \"out of scope (KDn)\"; `pnpm gate:repo` passes with one plan file."
      ],
      "finding_type": "error",
      "section": "Frontmatter `origin:` vs U1 - Audit doc and plan (Approach)",
      "severity": "P3",
      "suggested_fix": "In U1's Approach, state that the frontmatter `origin:` field is removed in the same PR, and carry the instruction in U1's Files/Verification so the plan never points at a deleted file.",
      "title": "Deleting the brainstorm leaves the plan's origin pointer dangling",
      "why_it_matters": "The plan's own provenance pointer breaks in the first PR of the stack. The frontmatter names `docs/brainstorms/2026-10-10-0002-feat-agent-surfaces-plan.md` as its `origin:`, and U1 deletes that file, leaving a field that resolves to nothing for the remaining eleven layers and for every later reader or agent that traces Product Contract provenance. The deletion itself is deliberate and stated (\"this plan carries its Product Contract\"), so the missing half is the frontmatter update that belongs in the same commit; without it the dangling reference survives the whole stack."
    },
    {
      "autofix_class": "safe_auto",
      "confidence": 75,
      "evidence": [
        "- **Objective:** A coding agent learns what a mutation run, CLI call, MCP call, report, or CI job concluded, why each failure or survivor happened, and what to do next, from documented schema fields alone and inside a 10,000-byte context budget; CI proves this on every change.",
        "- R11. An agent's default machine-mode output (stdout and stderr together) is at most 10,000 bytes on the repo's corpus.",
        "KD4. **Size the budget to the tightest agent client.** Codex's default tool-output limit is 10,000 bytes, the tightest documented client limit"
      ],
      "finding_type": "error",
      "section": "Goal Capsule Objective",
      "severity": "P3",
      "suggested_fix": "Rewrite the Objective clause as \"... from documented schema fields alone and inside outputs of at most 10,000 bytes\", matching R11's wording.",
      "title": "Objective says context budget where the plan measures output bytes",
      "why_it_matters": "The single most-read line of the plan promises something the rest of the document never measures. The Objective says an agent learns this \"inside a 10,000-byte context budget\", but every downstream definition — R11, KD4, the Budgets table, the Success Criteria — treats 10,000 as a per-output byte cap derived from Codex's tool-output truncation limit, not a constraint on the agent's accumulated context. A reader who takes the Objective literally expects success to be judged against context consumption, which nothing in the plan can verify; the verifiable reading is per-output. This is a wording drift, not a disagreement about the work, so the mechanical correction follows directly from R11."
    },
    {
      "autofix_class": "gated_auto",
      "confidence": 75,
      "evidence": [
        "`scripts/ci-job-summary.ts` (new Deno script, shebang with scoped `--allow-read`/`--allow-write`/`--allow-env`).",
        "| U12 | `mutation.yml` adopts the released surfaces | `.github/workflows/mutation.yml`, `scripts/ci-job-summary.ts` | U11, release (OQ3) |",
        "shard jobs write a summary from their terminal event."
      ],
      "finding_type": "omission",
      "section": "U9 - CI legibility with released tools and U12 - mutation.yml adopts the released surfaces (Files lines)",
      "severity": "P3",
      "suggested_fix": "In U12's Files line, mark `scripts/ci-job-summary.ts` as extending the U9 script (e.g. `scripts/ci-job-summary.ts` (extends the U9 script for shard summaries)), so the second owner is declared rather than implied.",
      "title": "Two units own the same new summary script",
      "why_it_matters": "Ownership of the CI summary formatter is ambiguous across the stack's first and last layers. U9 creates `scripts/ci-job-summary.ts` (\"new Deno script\"), and U12 — which lands after a release, a human-approved pin move, and eight intervening layers — lists the same file in its Files while U12's Approach implies extending it (\"shard jobs write a summary from their terminal event\") without saying so. A reviewer of U12 sees a file introduced by PR 2 with no note of what changed since, and the `allow-read`/`--allow-write`/`--allow-env` surface U9 deliberately scopes may silently widen to read shard artifacts the plan never authorised. Two owners is workable; leaving it undeclared is what makes an implementer guess."
    }
  ],
  "residual_risks": [
    "The Requirements Traceability table was checked against every unit's Requirements line and the reverse direction was not audited exhaustively: a requirement claimed by no unit, or a unit claiming a requirement absent from the table, could remain beyond the four discrepancies reported (R7/U6, R4-R6/U2, R4/U4).",
    "Origin traceability was verified only for identifier existence (A1-A5, R1-R33, F1-F4, AE1-AE8 all appear in docs/brainstorms/2026-10-10-0002-feat-agent-surfaces-plan.md); whether any Product Contract clause was silently reworded relative to that origin was not diffed line by line, beyond the Goal Capsule differences visible in the first 200 lines.",
    "The finding that U3 and U8's index rows under-list files assumes the 'Files touched (main)' column is meant as an index rather than a curated shortlist; if a convention elsewhere marks that column as principal files only, the finding drops to cosmetic."
  ],
  "reviewer": "coherence"
}
```
