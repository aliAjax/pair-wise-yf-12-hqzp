<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ElButton, ElTag, ElTable, ElTableColumn, ElInputNumber, ElSelect, ElOption, ElMessage
} from "element-plus";
import { useIngestStore } from "../stores/ingest";
import type { BatchRow, BusinessStatus, User } from "../types";

const props = defineProps<{ user: User; isLeader: boolean }>();
const store = useIngestStore();

const waveStatuses = ["营业中", "暂停营业", "库存紧张"] as BusinessStatus[];

const activeWaves = computed(() => store.activeWaves);
const activeRows = computed(() => {
  const waveIds = new Set(activeWaves.value.map((w) => w.id));
  const batchIds = new Set(store.data.batches.filter((b) => waveIds.has(b.waveId)).map((b) => b.id));
  return store.data.rows
    .filter((r) => batchIds.has(r.batchId))
    .sort((a, b) => (batchReadAt(a) - batchReadAt(b)) || a.snapshotTime - b.snapshotTime);
});

function batchReadAt(row: BatchRow): number {
  return store.data.batches.find((b) => b.id === row.batchId)?.readAt ?? 0;
}

function sourceName(row: BatchRow): string {
  return store.sourceMap.get(row.sourceId)?.fileName ?? row.sourceId;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

const editing = ref<Record<string, { stock: number; status: BusinessStatus }>>({});

function startEdit(row: BatchRow) {
  editing.value[row.id] = { stock: row.stock, status: row.status };
}

function saveEdit(row: BatchRow) {
  const patch = editing.value[row.id];
  if (!patch) return;
  try {
    store.fixRow(row.id, patch, props.isLeader);
    delete editing.value[row.id];
    ElMessage.success("已修正，等待重试");
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

function retry(row: BatchRow) {
  try {
    store.retryRow(row.id, props.user, props.isLeader);
    ElMessage.success(`只重试失败站点：${row.stationName}`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

const batchStateMeta: Record<string, { text: string; type: "info" | "warning" | "primary" | "success" | "danger" }> = {
  queued: { text: "排队中", type: "info" },
  processing: { text: "处理中", type: "primary" },
  partial_failed: { text: "有失败行", type: "danger" },
  conflicts_pending: { text: "冲突待处理", type: "warning" },
  done: { text: "批次完成", type: "success" }
};

const rowStateMeta: Record<string, { text: string; type: "info" | "warning" | "success" | "danger" }> = {
  pending: { text: "排队", type: "info" },
  success: { text: "已写入", type: "success" },
  failed: { text: "写入失败", type: "danger" },
  conflict: { text: "冲突", type: "warning" }
};
</script>

<template>
  <section class="panel">
    <h2>批次队列与进行中的波次</h2>
    <p class="hint">
      两个批次同时到达时同属一个波次，按读取时间逐批处理；任一批有失败行或未决冲突，
      站点就保持冻结，两批都做完才解冻。
    </p>

    <div v-if="activeWaves.length === 0" class="empty-block">暂无进行中的波次，请先导入盘点 CSV</div>

    <div v-for="wave in activeWaves" :key="wave.id" class="wave-card">
      <div class="wave-head">
        <strong>波次 {{ wave.id.slice(-6) }}</strong>
        <ElTag type="info">{{ wave.batches.length }} 个批次按读取时间排队</ElTag>
        <ElTag v-if="wave.queued" type="primary">批次处理中…</ElTag>
        <ElTag v-if="wave.failed" type="danger">{{ wave.failed }} 行失败待重试</ElTag>
        <ElTag v-if="wave.open" type="warning">{{ wave.open }} 个冲突待处理/批准</ElTag>
        <ElTag type="info" effect="plain">站点冻结中，两批都完成后解冻</ElTag>
      </div>
      <div class="batch-list">
        <div v-for="b in wave.batches" :key="b.id" class="batch-line">
          <ElTag :type="batchStateMeta[b.state].type" size="small">{{ batchStateMeta[b.state].text }}</ElTag>
          <span class="batch-name">{{ store.sourceMap.get(b.sourceId)?.fileName }}</span>
          <span class="batch-time">读取于 {{ fmtTime(b.readAt) }}</span>
        </div>
      </div>
    </div>

    <ElTable v-if="activeRows.length" :data="activeRows" size="small" stripe class="row-table">
      <ElTableColumn label="来源批次" min-width="170">
        <template #default="{ row }">
          <span class="cell-source">{{ sourceName(row) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="stationName" label="站点" width="110" />
      <ElTableColumn label="库存L" width="120">
        <template #default="{ row }">
          <template v-if="editing[row.id]">
            <ElInputNumber v-model="editing[row.id].stock" :min="0" :controls="false" size="small" style="width: 96px" />
          </template>
          <template v-else>{{ row.stock.toLocaleString() }}</template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="营业状态" width="120">
        <template #default="{ row }">
          <template v-if="editing[row.id]">
            <ElSelect v-model="editing[row.id].status" size="small">
              <ElOption v-for="s in waveStatuses" :key="s" :label="s" :value="s" />
            </ElSelect>
          </template>
          <template v-else>{{ row.status }}</template>
        </template>
      </ElTableColumn>
      <ElTableColumn label="盘点时间" width="160">
        <template #default="{ row }">{{ fmtTime(row.snapshotTime) }}</template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="90">
        <template #default="{ row }">
          <ElTag :type="rowStateMeta[row.state].type" size="small">{{ rowStateMeta[row.state].text }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作 / 原因" min-width="220">
        <template #default="{ row }">
          <template v-if="row.state === 'failed'">
            <p class="error-text">{{ row.error }}</p>
            <div class="row-actions">
              <ElButton v-if="!editing[row.id]" size="small" @click="startEdit(row)">就地修正</ElButton>
              <ElButton v-else size="small" type="success" @click="saveEdit(row)">保存修正</ElButton>
              <ElButton size="small" type="primary" @click="retry(row)">只重试本站点（第 {{ row.retries + 1 }} 次）</ElButton>
            </div>
          </template>
          <span v-else-if="row.state === 'conflict'" class="hint-inline">进入冲突台账处理</span>
          <span v-else-if="row.writtenAt" class="hint-inline">写入于 {{ fmtTime(row.writtenAt) }}</span>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>
