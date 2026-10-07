import type { BusinessStatus, User } from "../types";

/** 站点档案初始数据（员工通过 stationIds 绑定自己负责的站点） */
export const SEED_STATIONS = [
  { id: "st-east-1", name: "东区一站", area: "东区", manager: "刘建国", stock: 36000, status: "营业中" as BusinessStatus },
  { id: "st-east-2", name: "东区二站", area: "东区", manager: "刘建国", stock: 21500, status: "营业中" as BusinessStatus },
  { id: "st-air-1", name: "机场快线站", area: "机场线", manager: "王敏", stock: 9000, status: "库存紧张" as BusinessStatus },
  { id: "st-west-1", name: "西区中心站", area: "西区", manager: "陈志强", stock: 28000, status: "暂停营业" as BusinessStatus }
];

export const USERS: User[] = [
  { id: "u-liu", name: "刘建国（东区员工）", role: "staff", stationIds: ["st-east-1", "st-east-2"] },
  { id: "u-wang", name: "王敏（机场线员工）", role: "staff", stationIds: ["st-air-1"] },
  { id: "u-chen", name: "陈志强（西区员工）", role: "staff", stationIds: ["st-west-1"] },
  { id: "u-dispatch", name: "周调度（调度员）", role: "dispatcher", stationIds: [] }
];

/** 旧版台账 localStorage 键（首次打开时迁移） */
export const LEGACY_KEY = "hxwlfront-21-station-map";
export const STATE_KEY = "hxwlfront-21-ingest-v1";
export const SESSION_KEY = "hxwlfront-21-session-v1";
export const LOCK_KEY = "hxwlfront-21-leader-lock";
export const CHANNEL_NAME = "hxwlfront-21-ingest";

export interface DemoFile {
  fileName: string;
  content: string;
}

function csvOf(rows: [string, string, number, BusinessStatus, string][]): string {
  return ["站点名称,区域,库存L,营业状态,盘点时间", ...rows.map((r) => r.join(","))].join("\n");
}

/** 早班盘点（10-07 08:00） */
export const DEMO_BATCH_A: DemoFile = {
  fileName: "2026-10-07-早班盘点.csv",
  content: csvOf([
    ["东区一站", "东区", 34200, "营业中", "2026-10-07 08:00"],
    ["东区二站", "东区", 18800, "库存紧张", "2026-10-07 08:00"],
    ["机场快线站", "机场线", 8600, "库存紧张", "2026-10-07 08:00"]
  ])
};

/** 晚班盘点（10-07 16:00），与早班同站点，库存更新、状态有分歧 */
export const DEMO_BATCH_B: DemoFile = {
  fileName: "2026-10-07-晚班盘点.csv",
  content: csvOf([
    ["东区一站", "东区", 41000, "营业中", "2026-10-07 16:00"],
    ["东区二站", "东区", 22400, "营业中", "2026-10-07 16:00"],
    ["机场快线站", "机场线", 12500, "暂停营业", "2026-10-07 16:00"],
    ["西区中心站", "西区", 30500, "营业中", "2026-10-07 16:00"]
  ])
};
