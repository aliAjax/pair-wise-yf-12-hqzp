<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useLedgerStore } from "../stores/ledger";
import type { BatchStatus } from "../types";

const store = useLedgerStore();
const { batches, records, processing } = storeToRefs(store);

const statusLabel: Record<BatchStatus, string> = {
  queued: "排队中",
  processing: "处理中",
  done: "已完成",
  partial: "部分失败",
  duplicate: "重复导入"
};

function batchRecords(batchId: string) {
  return records.value.filter((r) => r.batchId === batchId);
}

function writeStatusLabel(s: string) {
  return (
    {
      pending: "待写入",
      written: "已写入",
      failed: "失败",
      conflict: "冲突",
      blocked: "冻结跳过"
    } as Record<string, string>
  )[s] ?? s;
}

function fmtTime(t: number) {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="panel">
    <div class="head-row">
      <h2>批次入库</h2>
      <button type="button" :disabled="processing" @click="store.resume()">
        {{ processing ? "续作中…" : "续作：重试失败站点" }}
      </button>
    </div>
    <div v-if="batches.length === 0" class="empty">暂无批次，请导入 CSV</div>
    <div v-for="b in batches" :key="b.id" class="batch">
      <div class="batch-head">
        <span class="batch-name">{{ b.sourceName }}</span>
        <span class="badge" :class="b.status">{{ statusLabel[b.status] }}</span>
      </div>
      <div class="batch-meta">
        <span>读取 {{ fmtTime(b.readAt) }}</span>
        <span>站点 {{ b.recordCount }}</span>
        <span class="ok">已写 {{ b.writtenCount }}</span>
        <span v-if="b.failedCount" class="err">失败 {{ b.failedCount }}</span>
        <span v-if="b.conflictCount" class="warn">冲突 {{ b.conflictCount }}</span>
      </div>
      <div v-if="batchRecords(b.id).length" class="rec-chips">
        <span
          v-for="r in batchRecords(b.id)"
          :key="r.id"
          class="chip"
          :class="r.writeStatus"
          :title="r.failReason ?? ''"
        >
          {{ r.siteName }} · {{ writeStatusLabel(r.writeStatus) }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.head-row h2 { margin: 0; }
.head-row button { padding: 8px 12px; font-size: 13px; }
.batch {
  border: 1px solid #dfe7f1;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fbfcfe;
}
.batch-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.batch-name { font-weight: 700; font-size: 14px; }
.badge { border-radius: 999px; padding: 3px 9px; font-size: 12px; white-space: nowrap; }
.badge.queued { background: #e8eef5; color: #445069; }
.badge.processing { background: #e3f0fb; color: #176b87; }
.badge.done { background: #e8f4ef; color: #14724f; }
.badge.partial { background: #fdeedc; color: #a05a13; }
.badge.duplicate { background: #fbe4e4; color: #a02828; }
.batch-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: #69758c; }
.batch-meta .ok { color: #14724f; }
.batch-meta .err { color: #a02828; }
.batch-meta .warn { color: #a05a13; }
.rec-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
  background: #eef2f7;
  color: #536078;
}
.chip.written { background: #e8f4ef; color: #14724f; }
.chip.failed { background: #fbe4e4; color: #a02828; }
.chip.conflict { background: #fdeedc; color: #a05a13; }
.chip.blocked { background: #e8eef5; color: #8a93a6; }
</style>
