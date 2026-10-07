---
"@systemfsoftware/stryker-js": minor
---

A verdict the engine decided without running a test now records the cost it measured. A mutant whose checker rejected it, or which no test covered while a checker looked at it, records its share of that check call's wall time; a mutant every configured checker ignored, or one left uncovered with no checker configured, records zero. A static mutant that a checker rejected carries that check time in the `StaticVerdict` event's `costMs` as well. A shard plan therefore balances on recorded times instead of pricing those verdicts at a whole-suite prediction, which previously dominated the plan. Killed, Survived and Timeout verdicts keep the measured test time they already recorded, and the run budget still counts only the verdicts that ran a test.
