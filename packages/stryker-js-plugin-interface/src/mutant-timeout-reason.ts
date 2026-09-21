export const HIT_LIMIT_REASON_PREFIX = 'Hit limit reached'

export const WALL_CLOCK_TIMEOUT_REASON = 'wall-clock-timeout'

export const hitLimitReachedReason = (count: number, limit: number): string =>
  `${HIT_LIMIT_REASON_PREFIX} (${count}/${limit})`

export const isHitLimitReason = (reason: string | undefined): boolean =>
  reason !== undefined && reason.startsWith(HIT_LIMIT_REASON_PREFIX)

export const isNamedTrap = (activeMutantId: string, namedTrapId: string | undefined): boolean =>
  namedTrapId !== undefined && activeMutantId === namedTrapId

export const wallClockTimeoutStopsRun = (status: string, reason: string | undefined): boolean =>
  status === 'timeout' && !isHitLimitReason(reason)
