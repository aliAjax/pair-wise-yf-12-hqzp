<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useLedgerStore } from "./stores/ledger";
import RoleBar from "./components/RoleBar.vue";
import ImportPanel from "./components/ImportPanel.vue";
import BatchesPanel from "./components/BatchesPanel.vue";
import SitesPanel from "./components/SitesPanel.vue";
import ConflictPanel from "./components/ConflictPanel.vue";

const store = useLedgerStore();
const { stats } = storeToRefs(store);

const project = {
  title: "油站台账入库",
  subtitle:
    "站点档案、冲突台账与批次接成可续作的入库流程：批次按读取时间排队，库存取来源较新者，营业状态未确认留两版；普通员工处理自己的冲突，调度员批准合并与回滚，越权直接拒绝。",
  stack: ["Vue3", "Vite", "TypeScript", "Pinia", "Element Plus"],
  metricLabels: ["油站数", "营业中", "库存紧张", "冻结站点", "未决冲突"]
};

onMounted(() => {
  store.migrateIfNeeded();
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 台账入库与冲突续作</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>
            {{
              [
                stats.siteCount,
                stats.openCount,
                stats.lowStockCount,
                stats.frozenCount,
                stats.conflictCount
              ][index]
            }}
          </strong>
        </article>
      </section>

      <section class="workspace">
        <div class="col-left">
          <RoleBar />
          <ImportPanel />
        </div>
        <div class="col-right">
          <SitesPanel />
          <BatchesPanel />
          <ConflictPanel />
        </div>
      </section>

      <footer class="foot">
        <button type="button" class="danger" @click="store.resetAll()">重置全部数据（含旧台账迁移）</button>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: minmax(300px, 380px) 1fr;
  gap: 18px;
  align-items: start;
}
.col-left,
.col-right {
  display: grid;
  gap: 18px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.foot {
  margin-top: 22px;
  display: flex;
  justify-content: center;
}
.foot button {
  padding: 8px 14px;
  font-size: 13px;
}
@media (max-width: 960px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
