export const BAKE_LANES = 4
export const BAKE_INSTALL_DEADLINE_SECONDS = 2

const KILL_GRACE_SECONDS = 10
const BOOT_SLACK_SECONDS = 30

export const bakeBudgetSeconds = (bake: { readonly fixtures: number }): number =>
  Math.ceil(bake.fixtures / BAKE_LANES) * (BAKE_INSTALL_DEADLINE_SECONDS + KILL_GRACE_SECONDS) + BOOT_SLACK_SECONDS
