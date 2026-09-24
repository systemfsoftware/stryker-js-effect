<script lang="ts">
  import { incrementBy } from './lib/math'

  let { start = 0 }: { start?: number } = $props()
  let count = $state(start)

  const doubled = $derived(count * 2)

  function increment(): void {
    count = incrementBy(count, 2)
  }
</script>

<button onclick={increment}>add {doubled}</button>
<p>{count + 1}</p>
{#if count > 0}
  <b>positive</b>
{:else}
  <b>zero</b>
{/if}
