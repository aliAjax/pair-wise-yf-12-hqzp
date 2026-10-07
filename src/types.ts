// 油站台账入库流程 —— 核心类型定义

export type Role = "employee" | "dispatcher";

/** 站点档案 */
export interface Site {
  id: string;
  name: string; // 油站名称
  area: string; // 区域
  manager: string; // 负责人
  frozen: boolean; // 冲突处理前冻结
  createdAt: number;
}

/** 批次：一次 CSV 导入 = 一个批次 */
export interface Batch {
  id: string;
  sourceName: string; // 来源文件名
  sourceHash: string; // 内容哈希（重复导入去重）
  readAt: number; // 读取时间（排队依据）
  sourceAt: number | null; // 盘点时间（CSV 内，可选）
  status: BatchStatus;
  recordCount: number;
  writtenCount: number;
  failedCount: number;
  conflictCount: number;
  createdAt: number;
}

export type BatchStatus =
  | "queued" // 排队中
  | "processing" // 处理中
  | "done" // 全部完成
  | "partial" // 部分站点失败（可续作）
  | "duplicate"; // 重复导入，未新增

/** 批次内的单站点记录 */
export interface BatchRecord {
  id: string;
  batchId: string;
  siteId: string;
  siteName: string;
  area: string;
  stock: number; // 库存（升）
  businessStatus: string; // 营业状态
  manager: string;
  sourceAt: number | null; // 该站点盘点时间（较新来源判定）
  writeStatus: WriteStatus;
  failReason: string | null;
}

export type WriteStatus =
  | "pending" // 待写入（续作时重试）
  | "written" // 已写入
  | "failed" // 写入失败（可重试）
  | "conflict" // 冲突挂起
  | "blocked"; // 站点冻结，跳过

/** 冲突台账条目 */
export interface Conflict {
  id: string;
  siteId: string;
  siteName: string;
  batchAId: string;
  batchBId: string;
  field: "businessStatus"; // 营业状态冲突
  valueA: string; // 较早来源版本
  valueB: string; // 较新来源版本
  status: ConflictStatus;
  proposal: Proposal | null; // 员工处理建议
  ownerId: string; // 归属员工（处理自己的冲突）
  handledBy: string | null;
  approvedBy: string | null;
  createdAt: number;
  handledAt: number | null;
  approvedAt: number | null;
}

export type ConflictStatus =
  | "pending" // 待处理（两版未确认，站点冻结）
  | "handled" // 员工已处理，待调度员批准
  | "resolved" // 调度员批准合并，已确认
  | "rolledBack"; // 已回滚（回到两版未确认）

export type Proposal = "A" | "B" | "keepBoth";

/** 台账条目：最终结果，保留来源 */
export interface LedgerEntry {
  siteId: string;
  stock: number;
  stockSourceBatchId: string | null; // 库存来源批次
  stockSourceAt: number | null;
  businessStatus: string;
  statusConfirmed: boolean; // 营业状态是否经确认
  statusSourceBatchId: string | null;
  dualStatus: { a: string; b: string } | null; // 未确认时留两版
  statusSourceA: string | null;
  statusSourceB: string | null;
  updatedAt: number;
}

export interface Stats {
  siteCount: number;
  openCount: number; // 营业中
  lowStockCount: number; // 库存紧张
  totalStock: number;
  frozenCount: number;
  conflictCount: number;
  recalculatedAt: number | null;
}

export interface CurrentUser {
  name: string;
  role: Role;
}
