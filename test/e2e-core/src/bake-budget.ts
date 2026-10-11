// Measured inputs, from the e2e-telemetry artifacts of PR #285 runs 38087270897, 38089587997 and 38092376483:
// pulling the guest image and booting the preparation microVM took 1.8-2.4 s across the five legs (max 2.4 s,
// only timed apart from the installs at head 83fa46bd0 / run 38092376483), and the install phase wall peaked at
// 103.9 s (run 38089587997; 90.8 s once boot was split out), which bounds every single `npm ci` inside it. The
// guest is 4096 MiB on microsandbox's default single vCPU, and the lanes share that one vCPU, so the 4-lane
// install wall bounds the whole 7-lane work too. Operator rule: 3x headroom, whole-bake ceiling <= 420 s, every
// fixture in one round if the guest allows. Derivation: BAKE_INSTALL_DEADLINE_SECONDS = ceil10(3 x 103.9) = 320;
// BAKE_BOOT_BUDGET_SECONDS = 3 x 2.4 = 7.2; BAKE_LANES = 7 because two rounds cannot fit 420 s even at 2x
// (7.2 + 2 x (210 + 10) = 447.2 s); bakeBudgetSeconds = 7.2 + ceil(fixtures / 7) x (320 + 10), so 337.2 s for
// the 7 fixtures. An 8th fixture makes two rounds (667.2 s), so re-derive then.

export const BAKE_INSTALL_DEADLINE_SECONDS = 320

export const BAKE_BOOT_BUDGET_SECONDS = 7.2

export const BAKE_LANES = 7

const KILL_GRACE_SECONDS = 10

export const bakeBudgetSeconds = (bake: { readonly fixtures: number }): number =>
  BAKE_BOOT_BUDGET_SECONDS +
  Math.ceil(bake.fixtures / BAKE_LANES) * (BAKE_INSTALL_DEADLINE_SECONDS + KILL_GRACE_SECONDS)
