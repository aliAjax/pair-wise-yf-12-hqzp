<script setup lang="ts">
import { computed, ref } from "vue";
import { ElTag, ElButton, ElEmpty } from "element-plus";
import { useIngestStore } from "../stores/ingest";

const store = useIngestStore();
const showAll = ref(false);

const logs = computed(() =>
  [...store.data.mergeLogs]
    .sort((a, b) => b.at - a.at)
    .slice(0, showAll.value ? undefined : 8)
);

const sources = computed(() => [...store.data.sources].sort((a, b) => b.importedAt - a.importedAt));

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function stationName(id: string): string {
  return store.stationMap.get(id)?.name ?? id;
}

function describe(change: Record<string, unknown>): string {
  const parts: string[] = [];
  if (change.stock !== undefined) parts.push(`库存→${Number(change.stock).toLocaleString()}L`);
  if (change.status !== undefined) parts.push(`状态→${change.status}`);
  if (change.pendingStatus !== undefined && change.pendingStatus !== null)
    parts.push(`待确认→${change.pendingStatus}`);
  if (change.pendingStatus === null) parts.push("待确认→清空");
  return parts.join("，") || "无字段变化";
}
</script>

<template>
  <section class="panel two-col">
    <div class="log-block">
      <h2>合并 / 回滚日志</h2>
      <ElEmpty v-if="logs.length === 0" description="尚无合并或回滚操作" :image-size="60" />
      <ul v-else class="log-list">
        <li v-for="log in logs" :key="log.id">
          <div class="log-line">
            <ElTag :type="log.action === 'merge' ? 'success' : 'danger'" size="small">
              {{ log.action === "merge" ? "批准合并" : "回滚" }}
            </ElTag>
            <strong>{{ stationName(log.stationId) }}</strong>
            <span class="dim">{{ log.kind === "stock" ? "库存" : "营业状态" }}</span>
          </div>
          <div class="log-detail dim">{{ log.operator }} · {{ fmt(log.at) }}</div>
          <div class="log-detail">变更后：{{ describe(log.after) }}</div>
        </li>
      </ul>
      <ElButton
        v-if="store.data.mergeLogs.length > 8"
        text size="small" @click="showAll = !showAll"
      >
        {{ showAll ? "收起" : `查看全部 ${store.data.mergeLogs.length} 条` }}
      </ElButton>
    </div>

    <div class="source-block">
      <h2>已留存的来源（{{ sources.length }}）</h2>
      <p class="hint">已解析批次与来源即时留存；相同内容重复导入不新增记录。</p>
      <ul class="source-list">
        <li v-for="src in sources" :key="src.id">
          <div class="log-line">
            <strong>{{ src.fileName }}</strong>
            <ElTag v-if="src.id === 'src-legacy-migration'" type="warning" size="small">迁移</ElTag>
          </div>
          <div class="log-detail dim">
            读取 {{ fmt(src.readAt) }} · 盘点 {{ fmt(src.snapshotTime) }} · 导入人 {{ src.importedBy }}
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
