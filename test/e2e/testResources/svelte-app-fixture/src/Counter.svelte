<script lang="ts">
  // @stryker-expect file Killed: ConditionalExpression, EqualityOperator
  // @stryker-expect file Survived: ArithmeticOperator
  import { incrementBy } from './lib/math'

  let { start = 0 }: { start?: number } = $props()
  let count = $state(start)

  // @stryker-expect next-line Killed: ArithmeticOperator
  const doubled = $derived(count * 2)

  // @stryker-expect next-line Killed: BlockStatement
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
