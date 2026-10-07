<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { useLedgerStore } from "../stores/ledger";
import type { ConflictStatus, Proposal } from "../types";

const store = useLedgerStore();
const { conflicts, batches, currentUser, isDispatcher } = storeToRefs(store);

const statusLabel: Record<ConflictStatus, string> = {
  pending: "待处理",
  handled: "已处理待批准",
  resolved: "已批准合并",
  rolledBack: "已回滚"
};

const list = computed(() =>
  [...conflicts.value].sort((a, b) => b.createdAt - a.createdAt)
);

function batchName(id: string) {
  if (id === "legacy") return "历史数据";
  return batches.value.find((b) => b.id === id)?.sourceName ?? "—";
}

function proposalLabel(p: Proposal | null) {
  if (!p) return "—";
  return p === "A" ? "采用旧版" : p === "B" ? "采用新版" : "保持两版";
}

function handle(c: { id: string }, proposal: Proposal) {
  store.handleConflict(c.id, proposal);
}

function approve(c: { id: string }) {
  store.approveMerge(c.id);
  ElMessage.success("已批准合并");
}

function rollback(c: { id: string }) {
  store.rollback(c.id);
  ElMessage.info("已回滚合并");
}

function fmtTime(t: number | null) {
  if (!t) return "—";
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="panel">
    <div class="head-row">
      <h2>冲突台账</h2>
      <span class="perm-hint">
        {{ isDispatcher ? "调度员：可批准合并 / 回滚" : `员工：仅可处理归属自己（${currentUser.name}）的冲突` }}
      </span>
    </div>
    <div v-if="list.length === 0" class="empty">暂无冲突</div>
    <div v-for="c in list" :key="c.id" class="conflict" :class="c.status">
      <div class="c-head">
        <span class="c-site">{{ c.siteName }}</span>
        <span class="badge" :class="c.status">{{ statusLabel[c.status] }}</span>
      </div>
      <div class="c-versions">
        <div class="ver">
          <span class="ver-tag old">旧版</span>
          <strong>{{ c.valueA }}</strong>
          <span class="ver-src">{{ batchName(c.batchAId) }}</span>
        </div>
        <div class="ver-arrow">↔</div>
        <div class="ver">
          <span class="ver-tag new">新版</span>
          <strong>{{ c.valueB }}</strong>
          <span class="ver-src">{{ batchName(c.batchBId) }}</span>
        </div>
      </div>
      <div class="c-meta">
        <span>归属：{{ c.ownerId }}</span>
        <span v-if="c.handledBy">处理：{{ c.handledBy }}</span>
        <span v-if="c.approvedBy">批准：{{ c.approvedBy }}</span>
        <span v-if="c.proposal">建议：{{ proposalLabel(c.proposal) }}</span>
      </div>

      <!-- 员工处理自己的冲突 -->
      <div v-if="!isDispatcher && c.status === 'pending'" class="c-actions">
        <span class="act-label">处理建议：</span>
        <button type="button" class="secondary" @click="handle(c, 'A')">采用旧版</button>
        <button type="button" class="secondary" @click="handle(c, 'B')">采用新版</button>
        <button type="button" class="secondary" @click="handle(c, 'keepBoth')">保持两版</button>
      </div>

      <!-- 调度员批准 / 回滚 -->
      <div v-if="isDispatcher && c.status === 'handled'" class="c-actions">
        <span class="act-label">调度员：</span>
        <button type="button" @click="approve(c)">批准合并</button>
      </div>
      <div v-if="isDispatcher && c.status === 'resolved'" class="c-actions">
        <span class="act-label">调度员：</span>
        <button type="button" class="danger" @click="rollback(c)">回滚合并</button>
      </div>

      <!-- 越权提示：员工尝试批准/回滚会被拒 -->
      <div v-if="!isDispatcher && (c.status === 'handled' || c.status === 'resolved')" class="c-actions">
        <button
          type="button"
          class="danger"
          @click="store.reject(c.status === 'handled' ? '批准合并（仅调度员）' : '回滚合并（仅调度员）')"
        >
          {{ c.status === "handled" ? "批准合并" : "回滚合并" }}（越权演示）
        </button>
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
  flex-wrap: wrap;
}
.head-row h2 { margin: 0; }
.perm-hint { color: #8a93a6; font-size: 12px; }
.conflict {
  border: 1px solid #dfe7f1;
  border-left: 4px solid #c8d4e2;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fbfcfe;
}
.conflict.pending { border-left-color: #a05a13; }
.conflict.handled { border-left-color: #176b87; }
.conflict.resolved { border-left-color: #14724f; }
.conflict.rolledBack { border-left-color: #a02828; }
.c-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.c-site { font-weight: 700; font-size: 15px; }
.badge { border-radius: 999px; padding: 3px 9px; font-size: 12px; white-space: nowrap; }
.badge.pending { background: #fdeedc; color: #a05a13; }
.badge.handled { background: #e3f0fb; color: #176b87; }
.badge.resolved { background: #e8f4ef; color: #14724f; }
.badge.rolledBack { background: #fbe4e4; color: #a02828; }
.c-versions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.ver { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #eef2f7; border-radius: 8px; padding: 8px 10px; }
.ver-tag { border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; }
.ver-tag.old { background: #e8eef5; color: #445069; }
.ver-tag.new { background: #fdeedc; color: #a05a13; }
.ver-src { color: #8a93a6; font-size: 11px; }
.ver-arrow { color: #8a93a6; }
.c-meta { display: flex; gap: 14px; flex-wrap: wrap; color: #69758c; font-size: 12px; margin-bottom: 8px; }
.c-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
.act-label { color: #69758c; font-size: 12px; }
.c-actions button { padding: 7px 11px; font-size: 12px; }
</style>
