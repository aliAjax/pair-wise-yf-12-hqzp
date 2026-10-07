<script setup lang="ts">
import { computed } from "vue";
import { ElTag, ElSelect, ElOption, ElButton, ElTooltip, ElSwitch } from "element-plus";
import { USERS } from "../data/seed";
import type { User } from "../types";
import { useIngestStore } from "../stores/ingest";

const props = defineProps<{
  user: User;
  isLeader: boolean;
  otherLeader: string | null;
}>();

const emit = defineEmits<{
  (e: "switch-user", id: string): void;
  (e: "take-over"): void;
}>();

const store = useIngestStore();

const roleTagType = computed(() => (props.user.role === "dispatcher" ? "warning" : "info"));
</script>

<template>
  <header class="topbar">
    <div>
      <p class="eyebrow">石油行业 · 盘点入库续作流程</p>
      <h1>油站台账合并入库</h1>
      <p class="subtitle">
        站点档案、冲突台账与批次接成可续作的入库流程：员工处理本站点冲突，调度员批准合并/回滚；
        两批次同时到达按读取时间排队，同站点库存取来源较新者，营业状态未确认保留两版，
        冲突站点冻结、波次完成后解冻重算。
      </p>
    </div>
    <div class="topbar-side">
      <div class="stack">
        <ElTag v-for="item in ['Vue3', 'Pinia', 'Element Plus', 'localStorage 续作']" :key="item" round>
          {{ item }}
        </ElTag>
      </div>
      <div class="session">
        <ElSelect
          :model-value="user.id"
          style="width: 230px"
          @update:model-value="(v: string) => emit('switch-user', v)"
        >
          <ElOption v-for="u in USERS" :key="u.id" :label="u.name" :value="u.id" />
        </ElSelect>
        <ElTag :type="roleTagType" size="large">{{ user.role === "dispatcher" ? "调度员" : "普通员工" }}</ElTag>
        <ElTooltip
          :content="isLeader ? '本标签页持写锁，可执行入库与冲突操作' : '另一个标签页持写锁，本页只读同步'"
          placement="bottom"
        >
          <ElTag :type="isLeader ? 'success' : 'danger'" size="large" effect="dark">
            {{ isLeader ? "● 写锁（本页）" : "○ 只读（他页写入中）" }}
          </ElTag>
        </ElTooltip>
        <ElButton v-if="!isLeader" size="small" @click="emit('take-over')">接管写锁</ElButton>
        <ElTooltip content="开启后，机场快线站的首次写入会模拟失败，用于演示“只重试失败站点、已解析批次与来源保留”" placement="bottom">
          <div class="sim-switch">
            <span>模拟写入失败</span>
            <ElSwitch v-model="store.simulateWriteFailure" :disabled="!isLeader" />
          </div>
        </ElTooltip>
      </div>
    </div>
  </header>
</template>
