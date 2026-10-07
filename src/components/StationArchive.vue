<script setup lang="ts">
import { computed, ref } from "vue";
import { ElTag, ElSelect, ElOption } from "element-plus";
import { useIngestStore } from "../stores/ingest";

const store = useIngestStore();
const areaFilter = ref("全部区域");

const areas = computed(() => ["全部区域", ...new Set(store.data.stations.map((s) => s.area))]);

const stations = computed(() =>
  [...store.data.stations]
    .filter((s) => areaFilter.value === "全部区域" || s.area === areaFilter.value)
    .sort((a, b) => Number(b.frozen) - Number(a.frozen) || a.id.localeCompare(b.id))
);

function sourceNameOf(rowId: string | null): string {
  if (!rowId) return "初始档案";
  const row = store.rowMap.get(rowId);
  if (!row) return rowId;
  return store.sourceMap.get(row.sourceId)?.fileName ?? row.sourceId;
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>站点档案</h2>
      <ElSelect v-model="areaFilter" size="small" style="width: 140px">
        <ElOption v-for="a in areas" :key="a" :label="a" :value="a" />
      </ElSelect>
    </div>

    <div class="station-grid">
      <article v-for="s in stations" :key="s.id" class="station-card" :class="{ frozen: s.frozen }">
        <div class="station-head">
          <strong>{{ s.name }}</strong>
          <ElTag v-if="s.frozen" type="danger" effect="dark" size="small">冻结中</ElTag>
          <ElTag v-else type="success" size="small">正常</ElTag>
        </div>
        <div class="station-meta">
          <span>{{ s.area }}</span>
          <span>负责人：{{ s.manager }}</span>
          <ElTag v-if="s.migrated" type="warning" size="small">旧数据迁移</ElTag>
        </div>
        <div class="stock-line">
          库存：<strong>{{ s.stock.toLocaleString() }}</strong> L
          <span class="source-hint">来源：{{ sourceNameOf(s.stockSourceId) }}</span>
        </div>
        <div class="status-line">
          营业状态：<ElTag size="small">{{ s.status }}</ElTag>
          <template v-if="s.pendingStatus">
            <span class="dual-arrow">⇄</span>
            <ElTag size="small" type="warning" effect="plain">待确认版：{{ s.pendingStatus }}</ElTag>
          </template>
        </div>
        <div class="source-hint status-source">状态来源：{{ sourceNameOf(s.statusSourceId) }}</div>
      </article>
    </div>
  </section>
</template>
