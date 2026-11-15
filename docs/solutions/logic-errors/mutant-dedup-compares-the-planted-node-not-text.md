---
title: Mutant deduplication compares the printed node the placers plant, never text it re-parses
date: 2026-11-15
category: logic-errors
module: stryker-js-instrumenter
problem_type: logic_error
component: mutant_set_policy
severity: medium
applies_when:
  - deciding whether two mutants at one site are the same code, or the same as the original
  - tempted to normalise printed code by scanning characters (parentheses, quotes, brackets)
retire_when: "the policy receives AST nodes or structural keys instead of printed text"
tags: [instrumenter, mutant-set-policy, equivalence, parentheses, printer]
---

## Problem

The default mutant-set policy culls a candidate whose code equals the original's, or an earlier candidate's at the same site. It compared `printNode` output after stripping outer parentheses from the text, found by a raw `(`/`)` depth walk. The walk counts a parenthesis inside a string, regex, template or comment. So `("(") + (")")` looked wrapped and lost its outer parentheses.

A character scanner that masks strings (the approach in a closed earlier attempt) still mis-lexes regexes, comments and template `${}` holding quotes. It can then cull mutants that main kept, hiding live mutants.

## Cause

The text was re-parsed after the AST had already said which parentheses are a node. The placers plant `unwrapParenthesizedExpression(replacement)`: only top-level `ParenthesizedExpression` wrappers go, and every inner one stays, because the printer relies on them (`new (f())()`, `(a?.b)()`, `(-1) ** 2`, `() => ({})`).

## Fix

The Transformer hands the policy `printNode(unwrapParenthesizedExpression(node))` for the original and for each replacement: the code actually planted. The policy compares those texts after `trim`, with no scanning. `(a, b)` and `a, b` at one site plant the same SequenceExpression, which the file printer parenthesises inside the mutant's conditional, so culling one as the other's duplicate is right.

Measured with `printNode` over oxc-parser output: removing every parenthesis node corrupts the code (`new (f())()` becomes `new f()()`), while removing only the top level keeps it intact.
