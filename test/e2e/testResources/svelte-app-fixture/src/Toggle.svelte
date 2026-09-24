<script lang="ts">
  import { toggleValue } from './lib/math'

  let { initial = false }: { initial?: boolean } = $props()
  let on = $state(initial)

  function toggle(): void {
    on = toggleValue(on)
  }
</script>

<button onclick={toggle}>
  {#if on}ON{:else}OFF{/if}
</button>
<p>{on ? 'yes' : 'no'}</p>
