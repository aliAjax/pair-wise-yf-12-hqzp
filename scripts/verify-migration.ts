// 迁移 + 续作验证
import assert from "node:assert/strict";
import { setActivePinia, createPinia } from "pinia";
import { useIngestStore } from "../src/stores/ingest";
import { LEGACY_KEY, STATE_KEY, DEMO_BATCH_A } from "../src/data/seed";

function makeStorage(seed: Record<string, string> = {}) {
  const bag: Record<string, string> = { ...seed };
  const session: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in bag ? bag[k] : null),
    setItem: (k: string, v: string) => { bag[k] = String(v); },
    removeItem: (k: string) => { delete bag[k]; }
  };
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => (k in session ? session[k] : null),
    setItem: (k: string, v: string) => { session[k] = String(v); },
    removeItem: (k: string) => { delete session[k]; }
  };
  return bag;
}
(globalThis as any).BroadcastChannel = class { postMessage() {} close() {} };
(globalThis as any).window = globalThis;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const ok = (label: string, cond: boolean) => { assert.ok(cond, label); pass++; console.log(`  ✓ ${label}`); };

console.log("A) 旧数据首次打开迁移进新台账并留来源");
const legacy = [
  { id: "seed-1", station: "东区一站", area: "东区", stock: 50000, manager: "刘建国", status: "营业中", notes: "", createdAt: "2026-09-01T08:00:00.000Z" },
  { id: "seed-2", station: "南郊新建站", area: "南区", stock: 12000, manager: "赵新", status: "暂停营业", notes: "", createdAt: "2026-09-02T08:00:00.000Z" }
];
const bag = makeStorage({ [LEGACY_KEY]: JSON.stringify(legacy) });
setActivePinia(createPinia());
let s = useIngestStore();
ok("迁移了 2 条旧记录", s.migratedCount === 2);
ok("新台账状态已写入 STATE_KEY", !!bag[STATE_KEY]);
const east = s.data.stations.find((x) => x.name === "东区一站")!;
ok("已有站点档案被旧数据更新（库存 50000）", east.stock === 50000 && east.migrated === true);
ok("旧记录里的新站点进入档案", s.data.stations.some((x) => x.name === "南郊新建站" && x.area === "南区"));
ok("迁移来源留存", s.data.sources.some((x) => x.id === "src-legacy-migration"));
ok("迁移产生了来源行", s.data.rows.filter((r) => r.sourceId === "src-legacy-migration").length === 2);

console.log("B) 再次打开不再重复迁移");
setActivePinia(createPinia());
s = useIngestStore();
ok("第二次启动迁移数=0", s.migratedCount === 0);
ok("迁移来源行不翻倍", s.data.rows.filter((r) => r.sourceId === "src-legacy-migration").length === 2);

console.log("C) 续作：页面重载后排队批次继续处理");
// 构造一个含 queued 批次的持久态
const state = JSON.parse(bag[STATE_KEY]);
state.batches.push({
  id: "batch-resume", sourceId: "src-resume", waveId: "wave-resume",
  readAt: Date.now(), state: "queued", createdAt: Date.now(), finishedAt: null
});
state.sources.push({
  id: "src-resume", fileName: "恢复用盘点.csv", fingerprint: "resume-1",
  snapshotTime: Date.now(), readAt: Date.now(), importedBy: "t", importedAt: Date.now(), waveId: "wave-resume"
});
state.rows.push({
  id: "row-resume-1", batchId: "batch-resume", sourceId: "src-resume",
  stationName: "东区一站", area: "东区", stationId: east.id,
  stock: 55000, status: "营业中", snapshotTime: Date.parse("2026-10-07T18:00:00"),
  state: "pending", error: null, writtenAt: null, retries: 0
});
bag[STATE_KEY] = JSON.stringify(state);
setActivePinia(createPinia());
s = useIngestStore();
await s.runQueue();
ok("重载后 queued 批次跑完", s.data.batches.find((b) => b.id === "batch-resume")!.state === "done");
ok("东区一站库存被续作批次更新为 55000", s.data.stations.find((x) => x.name === "东区一站")!.stock === 55000);

console.log("D) 没有旧数据时干净启动（种子档案，不产生迁移来源）");
const bag2 = makeStorage({});
setActivePinia(createPinia());
s = useIngestStore();
ok("4 个种子站点", s.data.stations.length === 4);
ok("无迁移来源", !s.data.sources.some((x) => x.id === "src-legacy-migration"));
ok("状态已持久化", !!bag2[STATE_KEY]);

void DEMO_BATCH_A;
console.log(`\n迁移/续作全部通过：${pass} 项断言`);
