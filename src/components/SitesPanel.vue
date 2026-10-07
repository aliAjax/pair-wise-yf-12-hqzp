<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useLedgerStore } from "../stores/ledger";

const store = useLedgerStore();
const { sites, ledger, batches, stats } = storeToRefs(store);

const rows = computed(() =>
  sites.value.map((s) => ({
    site: s,
    entry: ledger.value[s.id]
  }))
);

function batchName(id: string | null) {
  if (!id || id === "legacy") return "历史数据";
  return batches.value.find((b) => b.id === id)?.sourceName ?? "—";
}

function fmtTime(t: number | null) {
  if (!t) return "—";
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="panel">
    <div class="head-row">
      <h2>站点台账</h2>
      <button type="button" class="secondary" :disabled="stats.frozenCount > 0" @click="store.manualRecalc()">
        重新统计
      </button>
    </div>
    <p v-if="stats.frozenCount > 0" class="freeze-banner">
      ❄ 有 {{ stats.frozenCount }} 个站点冻结中，统计将在冲突处理完成、站点解冻后重算。
    </p>
    <div class="table-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th>油站</th>
            <th>区域</th>
            <th>库存(L)</th>
            <th>库存来源</th>
            <th>营业状态</th>
            <th>状态来源</th>
            <th>盘点时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ site, entry } in rows" :key="site.id" :class="{ frozen: site.frozen }">
            <td>
              <div class="site-name">
                {{ site.name }}
                <span v-if="site.frozen" class="frozen-tag">冻结</span>
              </div>
              <div class="site-sub">{{ site.manager }}</div>
            </td>
            <td>{{ site.area }}</td>
            <td class="num">{{ entry?.stock?.toLocaleString() ?? "—" }}</td>
            <td class="src">{{ batchName(entry?.stockSourceBatchId ?? null) }}</td>
            <td>
              <template v-if="entry?.dualStatus">
                <div class="dual">
                  <span class="dual-a">{{ entry.dualStatus.a }}</span>
                  <span class="dual-sep">↔</span>
                  <span class="dual-b">{{ entry.dualStatus.b }}</span>
                </div>
                <div class="dual-note">未确认 · 两版并存</div>
              </template>
              <template v-else>
                <span class="status-pill">{{ entry?.businessStatus ?? "—" }}</span>
              </template>
            </td>
            <td class="src">
              {{ entry?.statusConfirmed ? batchName(entry?.statusSourceBatchId ?? null) : "待确认" }}
            </td>
            <td class="src">{{ fmtTime(entry?.stockSourceAt ?? null) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="recalc-time">
      最近重算：{{ stats.recalculatedAt ? fmtTime(stats.recalculatedAt) : "尚未重算" }}
    </p>
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
.freeze-banner {
  background: #eef5fb;
  border: 1px solid #cfe0f0;
  color: #176b87;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin: 0 0 12px;
}
.table-wrap { overflow-x: auto; }
.ledger-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ledger-table th, .ledger-table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid #eef2f7;
  vertical-align: top;
}
.ledger-table th { color: #69758c; font-weight: 600; white-space: nowrap; }
.ledger-table tr.frozen { background: #f6f9fc; }
.site-name { font-weight: 700; display: flex; align-items: center; gap: 6px; }
.site-sub { color: #8a93a6; font-size: 12px; margin-top: 2px; }
.frozen-tag {
  background: #e3f0fb;
  color: #176b87;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 600;
}
.num { font-variant-numeric: tabular-nums; font-weight: 600; }
.src { color: #69758c; font-size: 12px; }
.status-pill {
  background: #e8f4ef;
  color: #14724f;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 12px;
  white-space: nowrap;
}
.dual { display: flex; align-items: center; gap: 6px; }
.dual-a { background: #e8eef5; color: #445069; border-radius: 6px; padding: 2px 7px; font-size: 12px; }
.dual-b { background: #fdeedc; color: #a05a13; border-radius: 6px; padding: 2px 7px; font-size: 12px; }
.dual-sep { color: #8a93a6; }
.dual-note { color: #a05a13; font-size: 11px; margin-top: 3px; }
.recalc-time { color: #8a93a6; font-size: 12px; margin: 12px 0 0; }
</style>
