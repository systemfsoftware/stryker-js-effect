export const BAKE_LANES = 4
export const BAKE_INSTALL_DEADLINE_SECONDS = 60

const KILL_GRACE_SECONDS = 10
const INSTALLS_PER_FIXTURE = 2
const BOOT_SLACK_SECONDS = 30

export const bakeBudgetSeconds = (bake: { readonly fixtures: number }): number =>
  Math.ceil(bake.fixtures / BAKE_LANES) * INSTALLS_PER_FIXTURE * (BAKE_INSTALL_DEADLINE_SECONDS + KILL_GRACE_SECONDS) +
  BOOT_SLACK_SECONDS

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const S = await import('effect/Schema')

  const busiestLaneInstalls = (fixtures: number): number =>
    Math.max(
      0,
      ...Array.from({ length: BAKE_LANES }, (_, lane) =>
        Array.from({ length: fixtures }, (_, index) =>
          index % BAKE_LANES === lane).filter((own) => own).length *
        INSTALLS_PER_FIXTURE),
    )

  it.prop(
    '∀n_FixtureCount_≡BudgetCoversTheBusiestLanesDeadlinesPlusBootSlack',
    { of: [S.Int.check(S.isBetween({ minimum: 0, maximum: 64 }))], subject: bakeBudgetSeconds },
    (subject, [fixtures]) =>
      subject({ fixtures }) ===
        busiestLaneInstalls(fixtures) * (BAKE_INSTALL_DEADLINE_SECONDS + KILL_GRACE_SECONDS) + BOOT_SLACK_SECONDS,
  )
}
