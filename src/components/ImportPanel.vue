<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { useLedgerStore } from "../stores/ledger";
import { sampleCsv } from "../lib/csv";

const store = useLedgerStore();
const { log, simulateFailure } = storeToRefs(store);
const fileInput = ref<HTMLInputElement | null>(null);

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  for (const file of files) {
    const text = await file.text();
    const res = store.importText(file.name, text);
    if (res.duplicate) ElMessage.warning(`「${file.name}」重复导入，未新增`);
    else if (res.ok) ElMessage.success(`「${file.name}」已读入 ${res.count} 站`);
    else ElMessage.error(`「${file.name}」无有效数据`);
  }
  input.value = "";
}

function loadSample(kind: "a" | "b") {
  const name = kind === "a" ? "盘点批次A-1001.csv" : "盘点批次B-1002.csv";
  const res = store.importText(name, sampleCsv(kind));
  if (res.duplicate) ElMessage.warning("示例批次已导入过");
  else ElMessage.success(`示例批次 ${kind === "a" ? "A" : "B"} 已读入`);
}

function downloadSample() {
  const blob = new Blob([sampleCsv("a")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "盘点模板.csv";
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="panel">
    <h2>导入盘点 CSV</h2>
    <div class="import-actions">
      <button type="button" @click="fileInput?.click()">选择 CSV 文件</button>
      <button type="button" class="secondary" @click="loadSample('a')">载入示例批次 A</button>
      <button type="button" class="secondary" @click="loadSample('b')">载入示例批次 B</button>
      <button type="button" class="secondary" @click="downloadSample()">下载模板</button>
      <input
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        multiple
        style="display: none"
        @change="onFiles"
      />
    </div>
    <label class="simulate">
      <input type="checkbox" v-model="simulateFailure" />
      演示：故意让首个站点写入失败（验证续作只重试未成功站点）
    </label>
    <p class="tip">
      两个批次同时到达按读取时间排队；同站点库存取来源较新者，营业状态未确认留两版。
    </p>
    <div class="log-box">
      <div v-for="(line, i) in log" :key="i" class="log-line">{{ line }}</div>
    </div>
  </section>
</template>

<style scoped>
.import-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.import-actions button { padding: 9px 12px; font-size: 13px; }
.simulate {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: #a05a13;
}
.simulate input { width: auto; }
.tip { margin: 10px 0 0; color: #8a93a6; font-size: 12px; line-height: 1.6; }
.log-box {
  margin-top: 12px;
  max-height: 220px;
  overflow: auto;
  background: #0f172a;
  border-radius: 8px;
  padding: 10px;
  display: grid;
  gap: 4px;
}
.log-line {
  color: #b6c2d6;
  font-size: 12px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
