<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessage } from "element-plus";
import TopBar from "./components/TopBar.vue";
import StatsBar from "./components/StatsBar.vue";
import ImportPanel from "./components/ImportPanel.vue";
import WavePanel from "./components/WavePanel.vue";
import ConflictLedger from "./components/ConflictLedger.vue";
import StationArchive from "./components/StationArchive.vue";
import MergeLogPanel from "./components/MergeLogPanel.vue";
import { useIngestStore } from "./stores/ingest";
import { createLeaderCoordinator } from "./utils/leader";
import { SESSION_KEY, STATE_KEY, USERS } from "./data/seed";
import type { User } from "./types";

const store = useIngestStore();

const initialUserId = localStorage.getItem(SESSION_KEY) || USERS[0].id;
const user = ref<User>(USERS.find((u) => u.id === initialUserId) ?? USERS[0]);

function switchUser(id: string) {
  const next = USERS.find((u) => u.id === id);
  if (next) {
    user.value = next;
    localStorage.setItem(SESSION_KEY, next.id);
  }
}

// ---- 多标签页写锁 ----
const coordinator = createLeaderCoordinator(() => {
  ElMessage.warning("写锁已被其他标签页接管，本页切换为只读");
});
const isLeader = coordinator.isLeader;
const otherLeader = coordinator.leaderOwner;

function takeOver() {
  // 主动接管：清掉过期/他页锁后重新竞争（非过期锁会在下一心跳纠正）
  ElMessage.info("已请求接管，若对方心跳过期本页将成为写页");
  coordinator.stepDown();
  window.setTimeout(() => coordinator.refreshLeaderInfo(), 0);
}

function onStorage(event: StorageEvent) {
  if (event.key === STATE_KEY) store.hydrateFromStorage();
}

onMounted(() => {
  coordinator.start();
  window.addEventListener("storage", onStorage);
  // 续作：上次遗留的排队批次在写页继续处理
  window.setTimeout(() => {
    if (isLeader.value && store.data.batches.some((b) => b.state === "queued")) {
      void store.runQueue();
    }
    if (store.migratedCount > 0) {
      ElMessage.success(`已将旧版台账中 ${store.migratedCount} 条记录迁移进新台账，并保留迁移来源`);
    }
  }, 200);
});

onUnmounted(() => window.removeEventListener("storage", onStorage));

const migrationNotice = computed(() =>
  store.migratedCount > 0 ? `旧版台账迁移完成：${store.migratedCount} 条记录已入库（见站点档案“旧数据迁移”标记）` : ""
);
</script>

<template>
  <main class="app">
    <div class="shell">
      <TopBar
        :user="user"
        :is-leader="isLeader"
        :other-leader="otherLeader"
        @switch-user="switchUser"
        @take-over="takeOver"
      />

      <StatsBar />

      <section v-if="migrationNotice" class="migration-banner">{{ migrationNotice }}</section>

      <div class="workspace-grid">
        <ImportPanel :user="user" :is-leader="isLeader" />
        <WavePanel :user="user" :is-leader="isLeader" />
      </div>

      <ConflictLedger :user="user" :is-leader="isLeader" />

      <StationArchive />

      <MergeLogPanel />

      <footer class="footer">
        <p>
          流程要点：普通员工只能处理自己站点的状态冲突；批准合并与回滚仅调度员可执行，越权直接拒绝。
          库存按来源盘点时间取较新者；营业状态未经员工确认前两版并存；冲突站点冻结，波次内两批都完成后解冻并重算统计。
          导入失败仅重试未成功站点；批次、来源持久化留存；重复导入不新增；旧数据首次打开自动迁移。
        </p>
      </footer>
    </div>
  </main>
</template>
