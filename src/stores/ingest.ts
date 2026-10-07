import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import {
  LEGACY_KEY,
  SEED_STATIONS,
  STATE_KEY
} from "../data/seed";
import {
  fingerprint,
  parseInventoryCsv,
  type ParsedRow
} from "../utils/csv";
import { PermissionError, type Batch, type BatchRow, type BusinessStatus,
  type Conflict, type ImportSource, type MergeLog, type PersistedState,
  type Station, type User } from "../types";

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface UploadedFile {
  fileName: string;
  content: string;
}

interface ImportReport {
  waveId: string;
  accepted: { source: ImportSource; rows: ParsedRow[] }[];
  duplicates: string[];
  parseErrors: { fileName: string; line: number; reason: string; raw: string }[];
}

/** 旧台账记录（旧版 App.vue 的最小闭环结构） */
interface LegacyRecord {
  id?: string;
  station?: string;
  area?: string;
  stock?: number;
  manager?: string;
  status?: string;
  notes?: string;
  createdAt?: string;
}

function isBusinessStatus(v: unknown): v is BusinessStatus {
  return v === "营业中" || v === "暂停营业" || v === "库存紧张";
}

function emptyState(): PersistedState {
  return {
    version: 1,
    stations: [],
    sources: [],
    batches: [],
    rows: [],
    conflicts: [],
    mergeLogs: [],
    finalizedWaves: [],
    migrated: false
  };
}

function seedStations(): Station[] {
  const now = Date.now();
  return SEED_STATIONS.map((s, i) => ({
    id: s.id,
    name: s.name,
    area: s.area,
    manager: s.manager,
    stock: s.stock,
    status: s.status,
    pendingStatus: null,
    stockSourceId: null,
    statusSourceId: null,
    frozen: false,
    freezeWaveId: null,
    updatedAt: now - (SEED_STATIONS.length - i) * 60_000
  }));
}

/** 旧数据首次打开时迁移进新台账并留来源 */
function migrateLegacy(): { state: PersistedState; migratedCount: number } {
  const base = emptyState();
  base.stations = seedStations();

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    base.migrated = true;
    return { state: base, migratedCount: 0 };
  }

  let legacy: LegacyRecord[] = [];
  try {
    legacy = JSON.parse(raw) as LegacyRecord[];
  } catch {
    legacy = [];
  }

  const now = Date.now();
  const migrationSource: ImportSource = {
    id: "src-legacy-migration",
    fileName: "旧版台账（自动迁移）",
    fingerprint: "legacy-migration",
    snapshotTime: now,
    readAt: now,
    importedBy: "系统迁移",
    importedAt: now,
    waveId: "wave-legacy"
  };
  base.sources.push(migrationSource);

  let count = 0;
  for (const rec of legacy) {
    if (!rec.station) continue;
    const time = rec.createdAt ? Date.parse(rec.createdAt) || now : now;
    let station = base.stations.find((s) => s.name === rec.station);
    const rowId = `row-legacy-${uid("")}`;
    if (!station) {
      station = {
        id: uid("st"),
        name: rec.station,
        area: rec.area || "未分区",
        manager: rec.manager || "未分配",
        stock: Number(rec.stock) || 0,
        status: isBusinessStatus(rec.status) ? rec.status : "营业中",
        pendingStatus: null,
        stockSourceId: rowId,
        statusSourceId: rowId,
        frozen: false,
        freezeWaveId: null,
        updatedAt: time,
        migrated: true
      };
      base.stations.push(station);
    } else {
      station.stock = Number(rec.stock) || station.stock;
      if (isBusinessStatus(rec.status)) station.status = rec.status;
      if (rec.manager) station.manager = rec.manager;
      station.stockSourceId = rowId;
      station.statusSourceId = rowId;
      station.updatedAt = time;
      station.migrated = true;
    }
    base.rows.push({
      id: rowId,
      batchId: "batch-legacy",
      sourceId: migrationSource.id,
      stationName: station.name,
      area: station.area,
      stationId: station.id,
      stock: station.stock,
      status: station.status,
      snapshotTime: time,
      state: "success",
      error: null,
      writtenAt: time,
      retries: 0
    });
    count++;
  }

  base.migrated = true;
  return { state: base, migratedCount: count };
}

function loadState(): { state: PersistedState; migratedCount: number } {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      return { state: { ...emptyState(), ...parsed }, migratedCount: 0 };
    }
  } catch {
    // 状态损坏则走迁移/种子重建
  }
  return migrateLegacy();
}

export const useIngestStore = defineStore("ingest", () => {
  const initial = loadState();
  const data = reactive<PersistedState>(initial.state);
  const migratedCount = ref(initial.migratedCount);
  const lastReport = ref<ImportReport | null>(null);
  const processing = ref(false);
  /** 演示用：让某站点的下一次写入失败（库存紧张且站点名包含“机场”时自动注入） */
  const simulateWriteFailure = ref(true);

  // ---------- 持久化 ----------
  function persist() {
    localStorage.setItem(STATE_KEY, JSON.stringify(data));
  }
  persist();

  /** 非 leader 标签页通过 storage 事件实时同步 */
  function hydrateFromStorage() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      const next = JSON.parse(raw) as PersistedState;
      Object.assign(data, next);
    } catch {
      // ignore
    }
  }

  // ---------- 权限 ----------
  function requireDispatcher(user: User) {
    if (user.role !== "dispatcher") {
      throw new PermissionError("越权拒绝：只有调度员可以批准合并、回滚和解冻");
    }
  }

  function requireStationAccess(user: User, stationId: string) {
    if (user.role === "dispatcher") return;
    if (!user.stationIds.includes(stationId)) {
      throw new PermissionError(`越权拒绝：你不是该站点负责人，不能处理它的冲突`);
    }
  }

  function requireWritable(isLeader: boolean) {
    if (!isLeader) throw new PermissionError("当前标签页为只读：另一个标签页正在执行写入");
  }

  // ---------- 查询辅助 ----------
  const stationMap = computed(() => new Map(data.stations.map((s) => [s.id, s])));
  const rowMap = computed(() => new Map(data.rows.map((r) => [r.id, r])));
  const sourceMap = computed(() => new Map(data.sources.map((s) => [s.id, s])));

  function stationIdByName(name: string, area: string): string {
    const hit = data.stations.find((s) => s.name === name);
    if (hit) return hit.id;
    const created: Station = {
      id: uid("st"),
      name,
      area,
      manager: "未分配",
      stock: 0,
      status: "营业中",
      pendingStatus: null,
      stockSourceId: null,
      statusSourceId: null,
      frozen: false,
      freezeWaveId: null,
      updatedAt: 0
    };
    data.stations.push(created);
    return created.id;
  }

  function waveBatchStates(waveId: string): Batch[] {
    return data.batches.filter((b) => b.waveId === waveId);
  }

  function waveOpenConflicts(waveId: string): Conflict[] {
    return data.conflicts.filter((c) => c.waveId === waveId && (c.status === "open" || c.status === "handled"));
  }

  function waveFailedRows(waveId: string): BatchRow[] {
    return data.rows.filter((r) => {
      const b = data.batches.find((x) => x.id === r.batchId);
      return b?.waveId === waveId && r.state === "failed";
    });
  }

  // ---------- 导入：解析留源、判重、按读取时间排队 ----------
  function importFiles(files: UploadedFile[], isLeader: boolean, operator: string): ImportReport {
    requireWritable(isLeader);

    const waveId = uid("wave");
    const readAtBase = Date.now();
    const report: ImportReport = { waveId, accepted: [], duplicates: [], parseErrors: [] };

    files.forEach((file, index) => {
      const fp = fingerprint(file.content);
      if (data.sources.some((s) => s.fingerprint === fp)) {
        report.duplicates.push(file.fileName);
        return; // 重复导入不新增记录
      }
      const { rows, errors } = parseInventoryCsv(file.content);
      errors.forEach((e) => report.parseErrors.push({ fileName: file.fileName, ...e }));
      if (rows.length === 0) return; // 全部非法：不建来源/批次

      // 两个批次同时到达：按读取时间排队（多文件视为同一次到达，保留选择次序）
      const readAt = readAtBase + index;
      const source: ImportSource = {
        id: uid("src"),
        fileName: file.fileName,
        fingerprint: fp,
        snapshotTime: Math.max(...rows.map((r) => r.snapshotTime)),
        readAt,
        importedBy: operator,
        importedAt: readAt,
        waveId
      };
      const batch: Batch = {
        id: uid("batch"),
        sourceId: source.id,
        waveId,
        readAt,
        state: "queued",
        createdAt: readAt,
        finishedAt: null
      };
      data.sources.push(source);
      data.batches.push(batch);
      data.rows.push(
        ...rows.map((r): BatchRow => ({
          id: uid("row"),
          batchId: batch.id,
          sourceId: source.id,
          stationName: r.stationName,
          area: r.area,
          stationId: stationIdByName(r.stationName, r.area),
          stock: r.stock,
          status: r.status,
          snapshotTime: r.snapshotTime,
          state: "pending",
          error: null,
          writtenAt: null,
          retries: 0
        }))
      );
      report.accepted.push({ source, rows });
    });

    persist();
    lastReport.value = report;
    void runQueue();
    return report;
  }

  // ---------- 队列：逐批处理，前一批处理完再下一批 ----------
  async function runQueue() {
    if (processing.value) return;
    processing.value = true;
    try {
      // 每次取最早读取的排队批次；失败行不阻塞后续批次，等待人工只重试该行
      for (;;) {
        const next = data.batches
          .filter((b) => b.state === "queued" || b.state === "processing")
          .sort((a, b) => a.readAt - b.readAt)[0];
        if (!next) break;
        if (next.state === "queued") {
          next.state = "processing";
          persist();
        }

        const rows = data.rows
          .filter((r) => r.batchId === next.id && r.state === "pending")
          .sort((a, b) => a.snapshotTime - b.snapshotTime);
        for (const row of rows) {
          await applyRow(row);
          persist();
        }
        refreshBatchState(next.id);
        // 仍有失败行的批次先挂起 partial_failed，但不阻塞后面的批次
        next.finishedAt = Date.now();
        persist();
        tryFinalizeWave(next.waveId);
      }
    } finally {
      processing.value = false;
      persist();
    }
  }

  function refreshBatchState(batchId: string) {
    const batch = data.batches.find((b) => b.id === batchId);
    if (!batch) return;
    const rows = data.rows.filter((r) => r.batchId === batchId);
    if (rows.some((r) => r.state === "failed")) {
      batch.state = "partial_failed";
    } else if (rows.some((r) => r.state === "conflict")) {
      batch.state = "conflicts_pending";
    } else {
      batch.state = "done";
    }
  }

  /** 演示用：每个含“机场”的站点只在首次写入尝试时失败一次 */
  function willFailWrite(row: BatchRow): boolean {
    if (!simulateWriteFailure.value || row.retries !== 0) return false;
    if (!row.stationName.includes("机场")) return false;
    const key = `sim-failed:${row.stationId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  }

  function applyRow(row: BatchRow): Promise<void> {
    return new Promise((resolve) => {
      const delay = 260 + Math.random() * 260;
      window.setTimeout(() => {
        const station = stationMap.value.get(row.stationId);
        if (!station) {
          row.state = "failed";
          row.error = "站点档案不存在";
          resolve();
          return;
        }
        if (willFailWrite(row)) {
          // 模拟站点写入失败：行保留为 failed，只重试这一行
          row.state = "failed";
          row.error = "模拟：站点台账写入失败（网络抖动），请修正后重试本行";
          resolve();
          return;
        }

        const currentWaveId = data.batches.find((b) => b.id === row.batchId)?.waveId;
        const touched = data.rows.some(
          (r) => r.id !== row.id && r.stationId === row.stationId &&
            (r.state === "success" || r.state === "conflict") &&
            data.batches.some((b) => b.id === r.batchId && b.waveId === currentWaveId)
        );

        if (!touched) {
          // 本站点本波次第一次落账
          station.stock = row.stock;
          station.status = row.status;
          station.pendingStatus = null;
          station.stockSourceId = row.id;
          station.statusSourceId = row.id;
          station.updatedAt = Date.now();
          row.state = "success";
          row.writtenAt = Date.now();
          resolve();
          return;
        }

        // 同站点第二个（及以后）来源：库存取来源较新者，状态没经确认留两版
        row.state = "conflict";
        freezeStation(station, row);

        const stockWinnerRow = newerRow(row, station.stockSourceId);
        const olderStockRow = stockWinnerRow.id === row.id ? station.stockSourceId! : row.id;
        if (stockWinnerRow.stock !== rowMap.value.get(olderStockRow)!.stock) {
          openConflict(station, row, "stock",
            "同站点库存取来源较新者，自动取值待调度员批准合并",
            stockWinnerRow, rowMap.value.get(olderStockRow)!);
        }
        // 较新来源的库存直接体现（批准只做确认/可回滚）
        if (stockWinnerRow.id === row.id && row.stock !== station.stock) {
          station.stock = row.stock;
          station.stockSourceId = row.id;
          station.updatedAt = Date.now();
        }

        const currentStatusRow = rowMap.value.get(station.statusSourceId!) ?? null;
        if (currentStatusRow && row.status !== station.status) {
          // 营业状态未经确认：保留两版
          const winner = newerRow(row, station.statusSourceId);
          const loser = winner.id === row.id ? currentStatusRow : row;
          openConflict(station, row, "status",
            "同站点两版营业状态未确认，保留两版待站点负责人处理",
            winner, loser);
          // 营业状态没经确认：确认版保持不动，另一版挂为待确认版
          station.pendingStatus = row.status !== station.status ? row.status : station.pendingStatus;
        } else if (currentStatusRow && row.status === station.status) {
          // 状态一致，无冲突
        }
        resolve();
      }, delay);
    });
  }

  function newerRow(a: BatchRow, otherRowId: string | null): BatchRow {
    const b = otherRowId ? rowMap.value.get(otherRowId) : undefined;
    if (!b) return a;
    // 来源较新 = 盘点时间较新；盘点时间相同按读取时间较新
    const sb = sourceMap.value.get(b.sourceId);
    const sa = sourceMap.value.get(a.sourceId);
    if (a.snapshotTime !== b.snapshotTime) return a.snapshotTime > b.snapshotTime ? a : b;
    return (sa?.readAt ?? 0) >= (sb?.readAt ?? 0) ? a : b;
  }

  function freezeStation(station: Station, row: BatchRow) {
    if (!station.frozen) {
      station.frozen = true;
      station.freezeWaveId = data.batches.find((b) => b.id === row.batchId)?.waveId ?? null;
    }
  }

  function openConflict(
    station: Station,
    row: BatchRow,
    kind: Conflict["kind"],
    kindNote: string,
    newer: BatchRow,
    older: BatchRow
  ) {
    const waveId = data.batches.find((b) => b.id === row.batchId)!.waveId;
    const existing = data.conflicts.find(
      (c) => c.stationId === station.id && c.kind === kind &&
        c.waveId === waveId && c.status !== "rolled_back"
    );
    if (existing) {
      // 第三个及以后来源：更新候选为最新的两者
      existing.rowIds = [newer.id, older.id];
      existing.sourceIds = [newer.sourceId, older.sourceId];
      existing.values = {
        newer: kind === "stock" ? newer.stock : newer.status,
        older: kind === "stock" ? older.stock : older.status
      };
      existing.newerWins = true;
      return;
    }
    data.conflicts.push({
      id: uid("cf"),
      waveId,
      stationId: station.id,
      kind,
      kindNote,
      rowIds: [newer.id, older.id],
      sourceIds: [newer.sourceId, older.sourceId],
      values: {
        newer: kind === "stock" ? newer.stock : newer.status,
        older: kind === "stock" ? older.stock : older.status
      },
      newerWins: true,
      status: "open",
      resolvedRowId: null,
      resolvedBy: null,
      resolvedAt: null,
      approvedBy: null,
      approvedAt: null,
      rollbackBy: null,
      rollbackAt: null,
      createdAt: Date.now()
    });
  }

  // ---------- 失败行：只重试没写成功的站点 ----------
  function retryRow(rowId: string, user: User, isLeader: boolean) {
    requireWritable(isLeader);
    const row = data.rows.find((r) => r.id === rowId);
    if (!row || row.state !== "failed") return;
    row.retries += 1;
    row.state = "pending";
    row.error = null;
    void user;
    persist();
    void runRetry(row);
  }

  async function runRetry(row: BatchRow) {
    if (processing.value) {
      // 队列运行中：等队列结束后统一扫尾
      const stop = window.setInterval(() => {
        if (!processing.value) {
          window.clearInterval(stop);
          void doRetry(row);
        }
      }, 200);
      return;
    }
    await doRetry(row);
  }  async function doRetry(row: BatchRow) {
    processing.value = true;
    try {
      if (row.state !== "pending") return;
      await applyRow(row);
      refreshBatchState(row.batchId);
      persist();
      const batch = data.batches.find((b) => b.id === row.batchId);
      if (batch) tryFinalizeWave(batch.waveId);
      // 失败重试期间可能还有排队批次，成功后继续排空
      await drainAfter();
    } finally {
      processing.value = false;
      persist();
    }
  }

  async function drainAfter() {
    if (!data.batches.some((b) => b.state === "queued" || b.state === "processing")) return;
    await runQueue();
  }

  /** 失败后就地修正（站点不允许改，只改库存/状态） */
  function fixRow(rowId: string, patch: { stock: number; status: BusinessStatus }, isLeader: boolean) {
    requireWritable(isLeader);
    const row = data.rows.find((r) => r.id === rowId);
    if (!row || row.state !== "failed") return;
    row.stock = patch.stock;
    row.status = patch.status;
    persist();
  }

  // ---------- 冲突处理：普通员工处理自己的冲突 ----------
  function resolveConflict(conflictId: string, chosenRowId: string, user: User, isLeader: boolean) {
    requireWritable(isLeader);
    const conflict = data.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    if (conflict.kind !== "status") {
      throw new PermissionError("库存冲突已按来源较新者自动取值，无需员工处理，等待调度员批准即可");
    }
    if (conflict.status !== "open" && conflict.status !== "rolled_back") {
      throw new PermissionError("该冲突已处理或已批准，不能重复处理");
    }
    requireStationAccess(user, conflict.stationId);
    if (!conflict.rowIds.includes(chosenRowId)) {
      throw new PermissionError("只能在两版来源中选择，不能提交其他值");
    }
    conflict.resolvedRowId = chosenRowId;
    conflict.resolvedBy = user.name;
    conflict.resolvedAt = Date.now();
    conflict.status = "handled";
    persist();
  }

  // ---------- 调度员：批准合并 ----------
  function approveConflict(conflictId: string, user: User, isLeader: boolean) {
    requireWritable(isLeader);
    requireDispatcher(user);
    const conflict = data.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    if (conflict.status === "approved") throw new PermissionError("冲突已批准，不能重复批准");

    const station = stationMap.value.get(conflict.stationId);
    if (!station) return;

    if (conflict.kind === "status" && conflict.status !== "handled") {
      throw new PermissionError("营业状态冲突须先由站点负责人选定版本");
    }

    const before = snapshotStatusFields(station);
    if (conflict.kind === "stock") {
      // 处理阶段已取较新者，批准即确认并留合并日志
      const winnerRow = rowMap.value.get(conflict.rowIds[0])!;
      station.stock = winnerRow.stock;
      station.stockSourceId = winnerRow.id;
    } else {
      const chosen = rowMap.value.get(conflict.resolvedRowId ?? conflict.rowIds[0])!;
      station.status = chosen.status;
      station.statusSourceId = chosen.id;
      station.pendingStatus = null;
    }
    station.updatedAt = Date.now();
    // 已解冻波次里的回滚再批准：站点重新进入冻结，批准后立即解冻
    if (!station.frozen) {
      station.frozen = true;
      station.freezeWaveId = conflict.waveId;
    }

    conflict.status = "approved";
    conflict.approvedBy = user.name;
    conflict.approvedAt = Date.now();

    data.mergeLogs.push({
      id: uid("log"),
      conflictId: conflict.id,
      waveId: conflict.waveId,
      stationId: station.id,
      kind: conflict.kind,
      action: "merge",
      operator: user.name,
      at: Date.now(),
      before,
      after: snapshotStatusFields(station)
    });

    conflict.rowIds.forEach((rid) => {
      const r = data.rows.find((x) => x.id === rid);
      if (r && r.state === "conflict") r.state = "success";
    });
    data.batches.forEach((b) => refreshBatchState(b.id));
    persist();
    tryFinalizeWave(conflict.waveId);
  }

  function snapshotStatusFields(station: Station): MergeLog["before"] {
    return {
      stock: station.stock,
      status: station.status,
      pendingStatus: station.pendingStatus,
      stockSourceId: station.stockSourceId,
      statusSourceId: station.statusSourceId
    };
  }

  // ---------- 调度员：回滚 ----------
  function rollbackConflict(conflictId: string, user: User, isLeader: boolean) {
    requireWritable(isLeader);
    requireDispatcher(user);
    const conflict = data.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    if (conflict.status !== "approved") throw new PermissionError("只能回滚已批准合并的冲突");

    const station = stationMap.value.get(conflict.stationId);
    if (!station) return;
    const before = snapshotStatusFields(station);

    if (conflict.kind === "stock") {
      const olderRow = rowMap.value.get(conflict.rowIds[1]);
      if (olderRow) {
        station.stock = olderRow.stock;
        station.stockSourceId = olderRow.id;
      }
    } else {
      const olderRow = rowMap.value.get(conflict.rowIds[1]);
      if (olderRow) {
        station.status = olderRow.status;
        station.statusSourceId = olderRow.id;
      }
      // 回滚后营业状态重新变成未确认的两版
      const newerRow = rowMap.value.get(conflict.rowIds[0]);
      station.pendingStatus = newerRow && newerRow.status !== station.status ? newerRow.status : station.pendingStatus;
    }
    station.updatedAt = Date.now();

    conflict.status = "rolled_back";
    conflict.rollbackBy = user.name;
    conflict.rollbackAt = Date.now();
    conflict.approvedBy = null;
    conflict.approvedAt = null;
    conflict.resolvedBy = null;
    conflict.resolvedAt = null;
    conflict.resolvedRowId = null;
    // 已解冻站点回滚后重新冻结，直到冲突重新处理并批准
    station.frozen = true;
    station.freezeWaveId = conflict.waveId;

    data.mergeLogs.push({
      id: uid("log"),
      conflictId: conflict.id,
      waveId: conflict.waveId,
      stationId: station.id,
      kind: conflict.kind,
      action: "rollback",
      operator: user.name,
      at: Date.now(),
      before,
      after: snapshotStatusFields(station)
    });

    conflict.rowIds.forEach((rid) => {
      const r = data.rows.find((x) => x.id === rid);
      if (r) r.state = "conflict";
    });
    data.batches.forEach((b) => refreshBatchState(b.id));
    persist();
  }

  // ---------- 两批都做完才解冻并重算统计 ----------
  function tryFinalizeWave(waveId: string): boolean {
    if (waveBatchStates(waveId).some((b) => b.state === "queued" || b.state === "processing")) return false;
    if (waveFailedRows(waveId).length > 0) return false;
    if (waveOpenConflicts(waveId).length > 0) return false;

    // 波次完成：解冻本站点（回滚后重新批准的站点也在这里再次解冻）
    data.stations.forEach((s) => {
      if (s.freezeWaveId === waveId) {
        s.frozen = false;
        s.freezeWaveId = null;
      }
    });
    if (!data.finalizedWaves.includes(waveId)) data.finalizedWaves.push(waveId);
    persist();
    return true;
  }

  function waveStatus(waveId: string) {
    const batches = waveBatchStates(waveId);
    const failed = waveFailedRows(waveId).length;
    const open = waveOpenConflicts(waveId).length;
    const finalized = data.finalizedWaves.includes(waveId);
    const queued = batches.some((b) => b.state === "queued" || b.state === "processing");
    return { batches, failed, open, finalized, queued };
  }

  // ---------- 统计（解冻后展示重算结果） ----------
  const stats = computed(() => {
    const total = data.stations.length;
    const open = data.stations.filter((s) => s.status === "营业中").length;
    const tight = data.stations.filter((s) => s.status === "库存紧张").length;
    const frozen = data.stations.filter((s) => s.frozen).length;
    const stockTotal = data.stations.reduce((sum, s) => sum + s.stock, 0);
    const pendingConflicts = data.conflicts.filter((c) => c.status === "open" || c.status === "handled").length;
    return { total, open, tight, frozen, stockTotal, pendingConflicts };
  });

  const activeWaves = computed(() => {
    const ids = [...new Set(data.batches.map((b) => b.waveId))];
    return ids
      .map((id) => ({ id, ...waveStatus(id) }))
      .filter((w) => !w.finalized)
      .sort((a, b) => (data.batches.find((x) => x.waveId === b.id)?.readAt ?? 0) -
                      (data.batches.find((x) => x.waveId === a.id)?.readAt ?? 0));
  });

  return {
    data,
    stats,
    activeWaves,
    processing,
    lastReport,
    migratedCount,
    simulateWriteFailure,
    persist,
    hydrateFromStorage,
    importFiles,
    runQueue,
    retryRow,
    fixRow,
    resolveConflict,
    approveConflict,
    rollbackConflict,
    tryFinalizeWave,
    waveStatus,
    stationMap,
    rowMap,
    sourceMap
  };
});
