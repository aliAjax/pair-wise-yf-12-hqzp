<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { ElButton, ElMessage, ElUpload } from "element-plus";
import type { UploadFile } from "element-plus";
import { DEMO_BATCH_A, DEMO_BATCH_B } from "../data/seed";
import { useIngestStore } from "../stores/ingest";
import type { User } from "../types";

const props = defineProps<{ user: User; isLeader: boolean }>();

const store = useIngestStore();
const busy = ref(false);
const uploadKey = ref(0);

interface PendingFile {
  fileName: string;
  content: string;
}
let pending: PendingFile[] = [];
let flushTimer: number | null = null;

async function readFiles(fileList: File[]): Promise<PendingFile[]> {
  return Promise.all(
    fileList.map(
      (file) =>
        new Promise<PendingFile>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ fileName: file.name, content: String(reader.result ?? "") });
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        })
    )
  );
}

function reportResult(report: ReturnType<typeof store.importFiles>) {
  const accepted = report.accepted.reduce((n, a) => n + a.rows.length, 0);
  if (accepted > 0) {
    ElMessage.success(`已解析入库：${report.accepted.length} 个批次 / ${accepted} 行，按读取时间排队处理`);
  }
  if (report.duplicates.length) {
    ElMessage.warning(`重复导入未新增：${report.duplicates.join("、")}`);
  }
  if (report.parseErrors.length) {
    ElMessage.error(`${report.parseErrors.length} 行解析失败（批次与已解析行均保留，修正后可重试）`);
  }
  if (accepted === 0 && !report.duplicates.length && !report.parseErrors.length) {
    ElMessage.info("所选文件未产生有效数据");
  }
}

async function flush() {
  flushTimer = null;
  if (pending.length === 0) return;
  const files = pending;
  pending = [];
  busy.value = true;
  try {
    // 多选时 on-change 可能逐文件触发，这里聚合同一次选择：
    // 多个文件视为“同时到达”，同波次按读取时间排队
    const report = store.importFiles(files, props.isLeader, props.user.name);
    reportResult(report);
  } finally {
    busy.value = false;
    uploadKey.value += 1; // 清空已选，允许再次选择同名文件
  }
}

async function onSelect(uploadFiles: UploadFile[]) {
  if (!props.isLeader) {
    ElMessage.error("当前标签页只读，请到持写锁的标签页操作");
    return;
  }
  const rawFiles = uploadFiles
    .filter((f) => f.status !== "ready" || true)
    .map((f) => f.raw)
    .filter((f): f is File => !!f);
  if (rawFiles.length === 0) return;
  const files = await readFiles(rawFiles);
  pending.push(...files);
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 300);
}

async function importDemoSimultaneous() {
  if (!props.isLeader) {
    ElMessage.error("当前标签页只读，请到持写锁的标签页操作");
    return;
  }
  busy.value = true;
  try {
    // 两个批次同时到达：同波次，按读取时间早班先、晚班后
    const files = [
      { fileName: DEMO_BATCH_A.fileName, content: DEMO_BATCH_A.content },
      { fileName: DEMO_BATCH_B.fileName, content: DEMO_BATCH_B.content }
    ];
    const report = store.importFiles(files, props.isLeader, props.user.name);
    reportResult(report);
  } finally {
    busy.value = false;
  }
}

onUnmounted(() => {
  if (flushTimer) window.clearTimeout(flushTimer);
});
</script>

<template>
  <section class="panel import-panel">
    <h2>盘点 CSV 入库</h2>
    <p class="hint">
      表头：<code>站点名称,区域,库存L,营业状态,盘点时间</code>。可多选文件——多文件视为同时到达，
      按读取时间排队；已解析的批次与来源立即留存，重复文件不新增。
    </p>
    <ElUpload
      :key="uploadKey"
      drag
      multiple
      accept=".csv,text/csv"
      :auto-upload="false"
      :show-file-list="false"
      :on-change="(_, uploadFiles) => onSelect(uploadFiles)"
    >
      <div class="el-icon--upload">
        <svg viewBox="0 0 1024 1024" width="46" height="46" fill="currentColor" aria-hidden="true">
          <path d="M518.3 459a8 8 0 0 0-12.6 0l-112 141.7a7.98 7.98 0 0 0 6.3 12.9h73.9V856c0 4.4 3.6 8 8 8h60c4.4 0 8-3.6 8-8V613.7H624c6.7 0 10.4-7.7 6.3-12.9L518.3 459z"/>
          <path d="M816 64H208C155 64 112 107 112 160v704c0 53 43 96 96 96h608c53 0 96-43 96-96V160c0-53-43-96-96-96zm16 800c0 8.8-7.2 16-16 16H208c-8.8 0-16-7.2-16-16V160c0-8.8 7.2-16 16-16h608c8.8 0 16 7.2 16 16v704z"/>
        </svg>
      </div>
      <div class="el-upload__text">把盘点 CSV 拖到此处，或<em>点击选择（可多选）</em></div>
    </ElUpload>
    <div class="import-actions">
      <ElButton type="primary" :loading="busy" @click="importDemoSimultaneous">
        演示：两个批次同时到达（早班 + 晚班）
      </ElButton>
      <span class="hint-inline">晚班来源较新，库存取晚班；机场站与西区状态分歧保留两版；机场站首次写入模拟失败</span>
    </div>
  </section>
</template>
