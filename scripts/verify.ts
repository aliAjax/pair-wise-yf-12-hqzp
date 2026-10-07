// 核心流程端到端验证（Node + tsx，localStorage/BroadcastChannel 均打桩）
import assert from "node:assert/strict";
import { setActivePinia, createPinia } from "pinia";
import { useIngestStore } from "../src/stores/ingest";
import { DEMO_BATCH_A, DEMO_BATCH_B, USERS } from "../src/data/seed";
import type { Conflict } from "../src/types";
import { fingerprint } from "../src/utils/csv";

const store: Record<string, string> = {};
const session: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; }
};
(globalThis as any).sessionStorage = {
  getItem: (k: string) => (k in session ? session[k] : null),
  setItem: (k: string, v: string) => { session[k] = String(v); },
  removeItem: (k: string) => { delete session[k]; }
};
(globalThis as any).BroadcastChannel = class { postMessage() {} close() {} };
(globalThis as any).window = globalThis;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const liu = USERS.find((u) => u.id === "u-liu")!;
const wang = USERS.find((u) => u.id === "u-wang")!;
const chen = USERS.find((u) => u.id === "u-chen")!;
const dispatcher = USERS.find((u) => u.id === "u-dispatch")!;

let pass = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, label);
  pass++;
  console.log(`  ✓ ${label}`);
}

function throws(label: string, fn: () => unknown, match: RegExp) {
  assert.throws(fn, match, label);
  pass++;
  console.log(`  ✓ ${label}`);
}

async function waitUntil(fn: () => boolean, label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await sleep(100);
  }
  assert.fail(`超时：${label}`);
}

setActivePinia(createPinia());
const s = useIngestStore();

console.log("1) 种子档案与初始统计");
ok("4 个种子站点", s.data.stations.length === 4);
ok("初始无冻结", s.data.stations.every((x) => !x.frozen));

console.log("2) 两个批次同时到达：同波次、按读取时间排队");
const report = s.importFiles(
  [
    { fileName: DEMO_BATCH_A.fileName, content: DEMO_BATCH_A.content },
    { fileName: DEMO_BATCH_B.fileName, content: DEMO_BATCH_B.content }
  ],
  true,
  "测试导入人"
);
ok("2 个来源全部接受", report.accepted.length === 2);
ok("同属一个波次", new Set(report.accepted.map((a) => a.source.waveId)).size === 1);
const waveId = report.waveId;
const ordered = s.data.batches.filter((b) => b.waveId === waveId).sort((a, b) => a.readAt - b.readAt);
ok("早班读取时间早于晚班", s.data.sources.find((x) => x.fileName.includes("早班"))!.readAt <
  s.data.sources.find((x) => x.fileName.includes("晚班"))!.readAt);
void ordered;

await waitUntil(() => !s.processing, "队列处理完成");

console.log("3) 同站点库存取来源较新者（晚班 16:00）");
const east1 = s.data.stations.find((x) => x.name === "东区一站")!;
ok("东区一站库存取晚班 41000", east1.stock === 41000);
const east2 = s.data.stations.find((x) => x.name === "东区二站")!;
ok("东区二站库存取晚班 22400", east2.stock === 22400);

console.log("4) 营业状态未经确认保留两版");
const air = s.data.stations.find((x) => x.name === "机场快线站")!;
ok("东区二站确认版保留早班状态（库存紧张）", east2.status === "库存紧张");
ok("东区二站存在待确认第二版（晚班营业中）", east2.pendingStatus === "营业中");
ok("机场站首次写入失败，两版状态待重试后产生", air.pendingStatus === null);

console.log("5) 冲突进台账，站点冻结");
const waveConflicts = s.data.conflicts.filter((c) => c.waveId === waveId);
ok("台账含库存冲突", waveConflicts.some((c) => c.kind === "stock"));
ok("台账含状态冲突", waveConflicts.some((c) => c.kind === "status"));
ok("已有冲突的站点全部冻结", [east1.id, east2.id].every((id) => s.stationMap.get(id)!.frozen));
const west = s.data.stations.find((x) => x.name === "西区中心站")!;
ok("仅单一来源的西区不冻结", west.frozen === false);

console.log("6) 导入失败只重试没写成功的站点；已解析批次与来源留住");
const airRow = s.data.rows.find((r) => r.stationName === "机场快线站" && r.state === "failed");
ok("机场站首次写入失败并留原因", !!airRow && !!airRow.error);
ok("来源数量仍为 2（未因失败丢失）", s.data.sources.filter((x) => x.waveId === waveId).length === 2);
s.retryRow(airRow!.id, wang, true);
await waitUntil(() => !s.processing, "重试完成");
ok("重试后该行为冲突（机场有两版状态）", s.data.rows.find((r) => r.id === airRow!.id)!.state === "conflict");
ok("重试计数=1", s.data.rows.find((r) => r.id === airRow!.id)!.retries === 1);
ok("重试产生冲突后机场站冻结并出现两版", air.frozen && air.pendingStatus !== null && air.pendingStatus !== air.status);

console.log("7) 重复导入不新增记录");
const dup = s.importFiles(
  [{ fileName: DEMO_BATCH_B.fileName, content: DEMO_BATCH_B.content }],
  true,
  "测试导入人"
);
ok("重复文件被识别", dup.duplicates.length === 1 && dup.accepted.length === 0);
ok("批次仍为 2", s.data.batches.filter((b) => b.waveId === waveId).length === 2);

console.log("8) 权限：越权直接拒绝");
const east2StatusConflict = s.data.conflicts.find((c) => c.kind === "status" && c.stationId === east2.id && c.status === "open")!;
throws("王敏不能处理东区二站（非本站点负责人）",
  () => s.resolveConflict(east2StatusConflict.id, east2StatusConflict.rowIds[0], wang, true), /越权拒绝/);
throws("非 leader 标签页拒绝写入",
  () => s.resolveConflict(east2StatusConflict.id, east2StatusConflict.rowIds[0], liu, false), /只读/);
throws("员工不能批准合并",
  () => s.approveConflict(east2StatusConflict.id, liu, true), /只有调度员/);
throws("员工不能回滚",
  () => s.rollbackConflict(east2StatusConflict.id, liu, true), /只有调度员/);
throws("员工不能处理库存冲突（自动取值，仅调度员批准）",
  () => s.resolveConflict(s.data.conflicts.find((c) => c.kind === "stock")!.id, "", liu, true), /无需员工处理/);

console.log("9) 员工处理自己的状态冲突，但调度员批准前仍冻结");
s.resolveConflict(east2StatusConflict.id, east2StatusConflict.rowIds[0], liu, true);
ok("冲突状态=handled", east2StatusConflict.status === "handled");
ok("批准前站点仍冻结", east2.frozen);

const airConflict = s.data.conflicts.find((c) => c.kind === "status" && c.stationId === air.id && c.status === "open")!;
throws("未处理的状态冲突调度员不能批准",
  () => s.approveConflict(airConflict.id, dispatcher, true), /须先由站点负责人选定/);
s.resolveConflict(airConflict.id, airConflict.rowIds[0], wang, true);

console.log("10) 两批都做完（失败清零+冲突全批准）才解冻");
const waveBefore = s.waveStatus(waveId);
ok("还有未决冲突，波次未完成", waveBefore.open > 0 && !s.tryFinalizeWave(waveId));

for (const c of s.data.conflicts.filter((c) => c.waveId === waveId && (c.status === "open" || c.status === "handled"))) {
  if (c.kind === "status" && c.status === "open") {
    const owner = c.stationId === east2.id ? liu : c.stationId === air.id ? wang : chen;
    s.resolveConflict(c.id, c.rowIds[0], owner, true);
  }
  s.approveConflict(c.id, dispatcher, true);
}
ok("波次已解冻完成", s.data.finalizedWaves.includes(waveId));
ok("东区一站/二站/机场均已解冻", [east1.id, east2.id, air.id].every((id) => !s.stationMap.get(id)!.frozen));
ok("东区二站待确认版已清空", east2.pendingStatus === null);
ok("两版状态取员工所选", ["营业中", "库存紧张"].includes(east2.status));

console.log("11) 调度员回滚恢复旧值并重新冻结，可重新批准");
const stockConflict = s.data.conflicts.find((c) => c.waveId === waveId && c.kind === "stock" && c.stationId === east1.id)!;
s.rollbackConflict(stockConflict.id, dispatcher, true);
ok("回滚后东区一站库存恢复早班 34200", east1.stock === 34200);
ok("回滚后站点重新冻结", east1.frozen);
throws("不能重复回滚",
  () => s.rollbackConflict(stockConflict.id, dispatcher, true), /只能回滚已批准/);
s.approveConflict(stockConflict.id, dispatcher, true);
ok("重新批准后库存回到晚班 41000", east1.stock === 41000);
ok("重新批准后再次解冻", !east1.frozen);
ok("日志包含 merge 与 rollback", s.data.mergeLogs.some((l) => l.action === "merge") &&
  s.data.mergeLogs.some((l) => l.action === "rollback"));

console.log("12) 统计重算");
ok("营业中数量与档案一致", s.stats.open === s.data.stations.filter((x) => x.status === "营业中").length);
ok("无冻结站点", s.stats.frozen === 0);

console.log(`\n全部通过：${pass} 项断言`);
void (0 as unknown as Conflict);
void fingerprint;
