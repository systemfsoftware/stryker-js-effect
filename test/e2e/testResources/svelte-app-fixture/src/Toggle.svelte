<script lang="ts">
  // @stryker-expect file Killed: StringLiteral
  import { toggleValue } from './lib/math'

  // @stryker-expect next-line Killed: BooleanLiteral
  let { initial = false }: { initial?: boolean } = $props()
  let on = $state(initial)

  // @stryker-expect next-line Killed: BlockStatement
  function toggle(): void {
    on = toggleValue(on)
  }
</script>

<button onclick={toggle}>
  {#if on}ON{:else}OFF{/if}
</button>
<p>{on ? 'yes' : 'no'}</p>
