<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElTag, ElRadioGroup, ElRadio, ElMessage, ElEmpty } from "element-plus";
import { useIngestStore } from "../stores/ingest";
import type { Conflict, User } from "../types";

const props = defineProps<{ user: User; isLeader: boolean }>();
const store = useIngestStore();

const filter = ref<"all" | "mine" | "open">("open");

function canAccessStation(stationId: string): boolean {
  return props.user.role === "dispatcher" || props.user.stationIds.includes(stationId);
}

const conflicts = computed(() => {
  const list = [...store.data.conflicts].sort((a, b) => b.createdAt - a.createdAt);
  if (filter.value === "mine") return list.filter((c) => canAccessStation(c.stationId));
  if (filter.value === "open") return list.filter((c) => c.status === "open" || c.status === "handled");
  return list;
});

function stationName(c: Conflict): string {
  return store.stationMap.get(c.stationId)?.name ?? c.stationId;
}

function rowLabel(rowId: string): string {
  const row = store.rowMap.get(rowId);
  if (!row) return rowId;
  const src = store.sourceMap.get(row.sourceId)?.fileName ?? "未知来源";
  const time = new Date(row.snapshotTime).toLocaleString("zh-CN", { hour12: false });
  return `${src}｜盘点 ${time}`;
}

function candidateValue(c: Conflict, rowId: string): string {
  const row = store.rowMap.get(rowId);
  if (!row) return "—";
  return c.kind === "stock" ? `${row.stock.toLocaleString()} L` : row.status;
}

function isNewer(c: Conflict, rowId: string): boolean {
  return c.rowIds[0] === rowId;
}

// 员工处理时的本地选择
const choices = ref<Record<string, string>>({});

function resolve(c: Conflict) {
  const chosen = choices.value[c.id];
  if (!chosen) {
    ElMessage.warning("请先在两版来源中选定一版");
    return;
  }
  try {
    store.resolveConflict(c.id, chosen, props.user, props.isLeader);
    ElMessage.success("已提交处理意见，等待调度员批准合并");
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

function approve(c: Conflict) {
  try {
    store.approveConflict(c.id, props.user, props.isLeader);
    ElMessage.success("已批准合并");
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

function rollback(c: Conflict) {
  try {
    store.rollbackConflict(c.id, props.user, props.isLeader);
    ElMessage.warning("已回滚，站点恢复为旧值/两版状态");
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

const statusMeta: Record<Conflict["status"], { text: string; type: "info" | "warning" | "success" | "danger" }> = {
  open: { text: "待处理", type: "danger" },
  handled: { text: "待批准", type: "warning" },
  approved: { text: "已批准合并", type: "success" },
  rolled_back: { text: "已回滚", type: "info" }
};
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>冲突台账</h2>
      <div class="filter-tabs">
        <ElButton :type="filter === 'open' ? 'primary' : 'default'" size="small" @click="filter = 'open'">
          待处理/批准
        </ElButton>
        <ElButton :type="filter === 'mine' ? 'primary' : 'default'" size="small" @click="filter = 'mine'">
          我负责的站点
        </ElButton>
        <ElButton :type="filter === 'all' ? 'primary' : 'default'" size="small" @click="filter = 'all'">
          全部
        </ElButton>
      </div>
    </div>

    <ElEmpty v-if="conflicts.length === 0" description="台账中没有冲突" :image-size="70" />

    <article
      v-for="c in conflicts"
      :key="c.id"
      class="conflict-card"
      :class="{ disabled: !canAccessStation(c.stationId) && user.role === 'staff' }"
    >
      <div class="conflict-head">
        <div>
          <strong>{{ stationName(c) }}</strong>
          <ElTag :type="c.kind === 'stock' ? 'warning' : 'danger'" size="small" effect="plain" class="kind-tag">
            {{ c.kind === "stock" ? "库存冲突（取来源较新者）" : "营业状态冲突（留两版）" }}
          </ElTag>
        </div>
        <ElTag :type="statusMeta[c.status].type">{{ statusMeta[c.status].text }}</ElTag>
      </div>
      <p class="kind-note">{{ c.kindNote }}</p>

      <ElRadioGroup
        :model-value="c.resolvedRowId ?? choices[c.id] ?? null"
        :disabled="c.kind === 'stock' || c.status !== 'open' || user.role === 'dispatcher' || !canAccessStation(c.stationId)"
        @update:model-value="(v: string) => (choices[c.id] = v)"
      >
        <div
          v-for="rid in c.rowIds"
          :key="rid"
          class="candidate"
          :class="{ chosen: (c.resolvedRowId ?? choices[c.id]) === rid }"
        >
          <ElRadio :value="rid">
            <span class="candidate-value">{{ candidateValue(c, rid) }}</span>
            <ElTag v-if="isNewer(c, rid)" type="success" size="small">来源较新</ElTag>
            <ElTag v-else type="info" size="small">较旧</ElTag>
            <span class="candidate-source">{{ rowLabel(rid) }}</span>
          </ElRadio>
        </div>
      </ElRadioGroup>

      <div class="conflict-meta">
        <span v-if="c.resolvedBy">处理人：{{ c.resolvedBy }}</span>
        <span v-if="c.approvedBy">批准人：{{ c.approvedBy }}</span>
        <span v-if="c.rollbackBy">回滚人：{{ c.rollbackBy }}</span>
      </div>

      <div class="conflict-actions">
        <template v-if="c.kind === 'status' && c.status === 'open'">
          <ElButton
            type="primary"
            size="small"
            :disabled="!isLeader || user.role !== 'staff' || !canAccessStation(c.stationId)"
            @click="resolve(c)"
          >
            {{ canAccessStation(c.stationId) ? "提交处理（员工）" : "非本站点负责人，禁止处理" }}
          </ElButton>
          <span v-if="user.role === 'dispatcher'" class="hint-inline">状态冲突须由站点员工先选定版本</span>
        </template>
        <template v-if="c.status === 'handled'">
          <ElButton type="success" size="small" :disabled="!isLeader || user.role !== 'dispatcher'" @click="approve(c)">
            批准合并（调度员）
          </ElButton>
        </template>
        <template v-if="c.kind === 'stock' && c.status === 'open'">
          <ElButton type="success" size="small" :disabled="!isLeader || user.role !== 'dispatcher'" @click="approve(c)">
            批准按较新来源合并（调度员）
          </ElButton>
          <span v-if="user.role === 'staff'" class="hint-inline">库存已自动取较新者，需调度员批准</span>
        </template>
        <template v-if="c.status === 'approved'">
          <ElButton type="danger" size="small" plain :disabled="!isLeader || user.role !== 'dispatcher'" @click="rollback(c)">
            回滚（调度员）
          </ElButton>
        </template>
        <template v-if="c.status === 'rolled_back'">
          <ElButton
            v-if="c.kind === 'status'"
            type="primary"
            size="small"
            :disabled="!isLeader || user.role !== 'staff' || !canAccessStation(c.stationId)"
            @click="resolve(c)"
          >
            重新选定版本（员工）
          </ElButton>
          <ElButton
            v-if="c.kind === 'stock'"
            type="success"
            size="small"
            :disabled="!isLeader || user.role !== 'dispatcher'"
            @click="approve(c)"
          >
            重新批准（调度员）
          </ElButton>
        </template>
        <ElTag v-if="!isLeader" type="danger" size="small">本页只读</ElTag>
      </div>
    </article>
  </section>
</template>
