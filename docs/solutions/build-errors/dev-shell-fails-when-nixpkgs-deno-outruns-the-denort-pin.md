---
title: The dev shell fails to evaluate when nixpkgs' deno outruns the denort pin in pnpm-release-management
date: 2026-11-13
category: build-errors
module: flake.nix (pnpm-release-management input)
problem_type: build_error
component: tooling
severity: high
applies_when:
  - A nixpkgs bump changes pkgs.deno's version
  - The locked pnpm-release-management input pins denort release zips for one deno version only
symptoms:
  - "nix develop fails: denort: pinned zips are v2.9.7 but pkgs.deno is 2.9.8 — re-pin releases"
  - Every hook that runs inside the dev shell (pre-commit, pre-push) fails before it starts
tags:
  - nix
  - deno
  - denort
  - flake-inputs
  - dependabot
---

# The dev shell fails to evaluate when nixpkgs' deno outruns the denort pin in pnpm-release-management

## Problem

The nixpkgs bump in #363 moved `pkgs.deno` to 2.9.8. The locked `pnpm-release-management` input (741c8c43) builds `denort` from release zips pinned for deno 2.9.7, and `nix/denort.nix:19` asserts that the two versions agree. So `nix develop` stopped evaluating, along with everything that runs in the dev shell.

## Fix

pnpm-release-management#88 (ebebdfeb) pins the denort zips per deno version, 2.9.8 included. Updating the input (`nix flake update pnpm-release-management`) takes that fix, and `nix develop` evaluates again with deno 2.9.8.

## Prevention

A nixpkgs bump and a bump of the input that pins tools built from nixpkgs' deno need to land together. When a nixpkgs update fails to evaluate on an assertion inside an input, update that input first; don't pin nixpkgs back.
