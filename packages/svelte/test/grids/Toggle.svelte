<!-- A control replacing itself with an input when pressed. -->
<script lang="ts">
  let { text }: { text: string } = $props();
  let editing = $state(false);
</script>

{#if editing}<input aria-label="Service" value={text} />{:else}<button
    type="button"
    onclick={() => (editing = true)}>{text}</button
  >{/if}
