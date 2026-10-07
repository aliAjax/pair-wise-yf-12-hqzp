// 入库流程领域模型

export type Role = "staff" | "dispatcher";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** 普通员工仅能处理自己负责站点的冲突 */
  stationIds: string[];
}

export type BusinessStatus = "营业中" | "暂停营业" | "库存紧张";

/** 站点档案 */
export interface Station {
  id: string;
  name: string;
  area: string;
  manager: string;
  /** 当前库存 L */
  stock: number;
  /** 已确认生效的营业状态 */
  status: BusinessStatus;
  /** 未确认时并存的第二版营业状态（null 表示无待确认版本） */
  pendingStatus: BusinessStatus | null;
  /** 生效库存的来源行 */
  stockSourceId: string | null;
  /** 生效状态的来源行 */
  statusSourceId: string | null;
  /** 冲突处理完前站点冻结；wave 全部完成后解冻 */
  frozen: boolean;
  /** 冻结所属批次波次 */
  freezeWaveId: string | null;
  updatedAt: number;
  /** 旧数据迁移标记 */
  migrated?: boolean;
}

/** 已解析的盘点文件来源（留住来源，重复文件不新增） */
export interface ImportSource {
  id: string;
  fileName: string;
  /** 文件内容指纹，用于重复导入判重 */
  fingerprint: string;
  /** 站点盘点时间（取文件内容中最新的盘点时间，用于“来源较新者”比较） */
  snapshotTime: number;
  /** 文件读取时间；两个批次同时到达按它排队 */
  readAt: number;
  importedBy: string;
  importedAt: number;
  waveId: string;
}

export type RowState =
  | "pending" // 排队中
  | "success" // 已写入
  | "failed" // 导入失败，可只重试此行
  | "conflict"; // 产生了冲突台账（是否最终落账看冲突处理结果）

/** 批次内的一行盘点数据：批次和行都解析后持久化，失败也留住 */
export interface BatchRow {
  id: string;
  batchId: string;
  sourceId: string;
  stationName: string;
  area: string;
  stationId: string;
  stock: number;
  status: BusinessStatus;
  snapshotTime: number;
  state: RowState;
  error: string | null;
  writtenAt: number | null;
  /** 失败后允许就地修正后重试 */
  retries: number;
}

export type BatchState =
  | "queued" // 按读取时间排队
  | "processing"
  | "partial_failed" // 仍有失败行
  | "conflicts_pending" // 冲突未全部处理/批准
  | "done"; // 全部成功/冲突已批准（波次层面再统一解冻）

export interface Batch {
  id: string;
  sourceId: string;
  waveId: string;
  readAt: number;
  state: BatchState;
  createdAt: number;
  finishedAt: number | null;
}

export type ConflictKind = "stock" | "status";
export type ConflictStatus = "open" | "handled" | "approved" | "rolled_back";

/** 冲突台账 */
export interface Conflict {
  id: string;
  waveId: string;
  stationId: string;
  kind: ConflictKind;
  /** 库存冲突：自动按来源较新者取值后留账待批准 */
  kindNote: string;
  /** 两个候选来源行（较新在前） */
  rowIds: [string, string];
  sourceIds: [string, string];
  values: {
    newer: number | BusinessStatus;
    older: number | BusinessStatus;
  };
  newerWins: boolean;
  status: ConflictStatus;
  /** 员工处理状态冲突时选定的版本来源行 */
  resolvedRowId: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
  rollbackBy: string | null;
  rollbackAt: number | null;
  createdAt: number;
}

/** 合并/回滚日志（回滚时按快照还原） */
export interface MergeLog {
  id: string;
  conflictId: string;
  waveId: string;
  stationId: string;
  kind: ConflictKind;
  action: "merge" | "rollback";
  operator: string;
  at: number;
  before: {
    stock?: number;
    status?: BusinessStatus;
    pendingStatus?: BusinessStatus | null;
    stockSourceId?: string | null;
    statusSourceId?: string | null;
  };
  after: {
    stock?: number;
    status?: BusinessStatus;
    pendingStatus?: BusinessStatus | null;
    stockSourceId?: string | null;
    statusSourceId?: string | null;
  };
}

export interface PersistedState {
  version: number;
  stations: Station[];
  sources: ImportSource[];
  batches: Batch[];
  rows: BatchRow[];
  conflicts: Conflict[];
  mergeLogs: MergeLog[];
  /** 已完成（已解冻重算）的波次 */
  finalizedWaves: string[];
  migrated: boolean;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
