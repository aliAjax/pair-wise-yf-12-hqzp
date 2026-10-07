<script setup lang="ts">
import { computed } from "vue";
import { useIngestStore } from "../stores/ingest";

const store = useIngestStore();
const stats = computed(() => store.stats);
</script>

<template>
  <section class="metrics">
    <article class="metric">
      <span>油站数</span>
      <strong>{{ stats.total }}</strong>
    </article>
    <article class="metric">
      <span>营业中</span>
      <strong>{{ stats.open }}</strong>
    </article>
    <article class="metric">
      <span>库存紧张</span>
      <strong>{{ stats.tight }}</strong>
    </article>
    <article class="metric">
      <span>冻结站点（处理完前不可用）</span>
      <strong :class="{ warn: stats.frozen > 0 }">{{ stats.frozen }}</strong>
    </article>
    <article class="metric">
      <span>库存合计 L</span>
      <strong>{{ stats.stockTotal.toLocaleString() }}</strong>
    </article>
    <article class="metric">
      <span>待处理/批准冲突</span>
      <strong :class="{ warn: stats.pendingConflicts > 0 }">{{ stats.pendingConflicts }}</strong>
    </article>
  </section>
</template>
