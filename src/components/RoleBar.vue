<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useLedgerStore } from "../stores/ledger";
import type { Role } from "../types";

const store = useLedgerStore();
const { currentUser } = storeToRefs(store);

const role = computed<Role>({
  get: () => currentUser.value.role,
  set: (val) => store.setRole(val)
});
</script>

<template>
  <section class="panel role-bar">
    <div class="role-id">
      <span class="role-label">当前身份</span>
      <input v-model="currentUser.name" class="role-name" placeholder="姓名" />
      <span class="role-tag" :class="role === 'dispatcher' ? 'dispatcher' : 'employee'">
        {{ role === "dispatcher" ? "调度员" : "员工" }}
      </span>
    </div>
    <div class="role-switch">
      <label :class="{ active: role === 'employee' }">
        <input type="radio" value="employee" v-model="role" />
        员工（处理自己的冲突）
      </label>
      <label :class="{ active: role === 'dispatcher' }">
        <input type="radio" value="dispatcher" v-model="role" />
        调度员（批准合并 / 回滚）
      </label>
    </div>
    <p class="role-hint">
      员工可处理归属自己的冲突；批准合并与回滚仅调度员可执行，越权直接拒绝。
    </p>
  </section>
</template>

<style scoped>
.role-bar { display: grid; gap: 10px; }
.role-id { display: flex; align-items: center; gap: 10px; }
.role-label { color: #69758c; font-size: 13px; }
.role-name { max-width: 140px; }
.role-tag {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}
.role-tag.employee { background: #e8f4ef; color: #14724f; }
.role-tag.dispatcher { background: #fdeedc; color: #a05a13; }
.role-switch { display: flex; gap: 18px; flex-wrap: wrap; }
.role-switch label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #445069;
  cursor: pointer;
}
.role-switch label.active { color: #176b87; font-weight: 700; }
.role-switch input { width: auto; }
.role-hint { margin: 0; color: #8a93a6; font-size: 12px; }
</style>
