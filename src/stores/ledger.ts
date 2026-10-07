import { defineStore } from "pinia";
import { parseCsv, hashContent } from "../lib/csv";
import type {
  Batch,
  BatchRecord,
  BatchStatus,
  Conflict,
  CurrentUser,
  LedgerEntry,
  Proposal,
  Role,
  Site,
  Stats
} from "../types";

const STORAGE_KEY = "hxwlfront-21-ledger-v1";
const LEGACY_KEY = "hxwlfront-21-station-map";

/** 旧数据首次打开时的种子（模拟历史 localStorage 台账） */
const LEGACY_SEED = [
  {
    station: "东区一站",
    area: "东区",
    stock: 36000,
    manager: "刘站长",
    status: "营业中",
    createdAt: "2026-09-01T00:00:00.000Z"
  },
  {
    station: "机场快线站",
    area: "机场线",
    stock: 9000,
    manager: "王站长",
    status: "库存紧张",
    createdAt: "2026-09-02T00:00:00.000Z"
  }
];

interface PersistShape {
  migrated: boolean;
  currentUser: CurrentUser;
  sites: Site[];
  batches: Batch[];
  records: BatchRecord[];
  conflicts: Conflict[];
  ledger: Record<string, LedgerEntry>;
  stats: Stats;
  simulateFailure: boolean;
}

function uuid(): string {
  return crypto.randomUUID();
}

function emptyStats(): Stats {
  return {
    siteCount: 0,
    openCount: 0,
    lowStockCount: 0,
    totalStock: 0,
    frozenCount: 0,
    conflictCount: 0,
    recalculatedAt: null
  };
}

function loadState(): PersistShape {
  const blank: PersistShape = {
    migrated: false,
    currentUser: { name: "张三", role: "employee" },
    sites: [],
    batches: [],
    records: [],
    conflicts: [],
    ledger: {},
    stats: emptyStats(),
    simulateFailure: false
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return { ...blank, ...parsed, stats: { ...emptyStats(), ...(parsed.stats ?? {}) } };
  } catch {
    return blank;
  }
}

export const useLedgerStore = defineStore("ledger", {
  state: (): PersistShape & { log: string[]; processing: boolean } => ({
    ...loadState(),
    log: [],
    processing: false
  }),

  getters: {
    frozenSites(state): Site[] {
      return state.sites.filter((s) => s.frozen);
    },
    activeConflicts(state): Conflict[] {
      return state.conflicts.filter((c) => c.status === "pending" || c.status === "handled");
    },
    partialBatches(state): Batch[] {
      return state.batches.filter((b) => b.status === "queued" || b.status === "partial");
    },
    siteName: (state) => (siteId: string) =>
      state.sites.find((s) => s.id === siteId)?.name ?? "未知站点",
    isDispatcher(state): boolean {
      return state.currentUser.role === "dispatcher";
    }
  },

  actions: {
    // ---------- 角色与权限 ----------
    setRole(role: Role) {
      this.currentUser.role = role;
      this.pushLog(`当前身份切换为：${role === "dispatcher" ? "调度员" : "员工"} ${this.currentUser.name}`);
      this.persist();
    },
    setName(name: string) {
      this.currentUser.name = name.trim() || this.currentUser.name;
      this.persist();
    },
    /** 越权直接拒绝，并写入日志 */
    reject(action: string): false {
      this.pushLog(`⛔ 越权操作已拒绝：${this.currentUser.name}（${this.currentUser.role === "dispatcher" ? "调度员" : "员工"}）无权执行「${action}」`);
      return false;
    },

    // ---------- 日志 ----------
    pushLog(line: string) {
      const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      this.log = [`${stamp}  ${line}`, ...this.log].slice(0, 200);
    },

    // ---------- 持久化 ----------
    persist() {
      const data: PersistShape = {
        migrated: this.migrated,
        currentUser: this.currentUser,
        sites: this.sites,
        batches: this.batches,
        records: this.records,
        conflicts: this.conflicts,
        ledger: this.ledger,
        stats: this.stats,
        simulateFailure: this.simulateFailure
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },

    // ---------- 旧数据迁移（首次打开） ----------
    migrateIfNeeded() {
      if (this.migrated) return;
      let legacy: any[] = [];
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          legacy = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        legacy = [];
      }
      if (legacy.length === 0) {
        // 首次打开且无旧台账：播种历史数据，模拟迁移来源
        localStorage.setItem(LEGACY_KEY, JSON.stringify(LEGACY_SEED));
        legacy = LEGACY_SEED;
      }
      this.pushLog(`检测到旧版台账数据，开始迁移…`);
      let count = 0;
      for (const row of legacy) {
        const name = String(row.station ?? row.name ?? "").trim();
        if (!name) continue;
        const site = this.ensureSite(name, String(row.area ?? ""), String(row.manager ?? ""));
        const at = row.createdAt ? Date.parse(row.createdAt) : Date.parse("2026-09-01T00:00:00.000Z");
        this.ledger[site.id] = {
          siteId: site.id,
          stock: Number(row.stock) || 0,
          stockSourceBatchId: "legacy",
          stockSourceAt: Number.isFinite(at) ? at : Date.now(),
          businessStatus: String(row.status ?? "营业中"),
          statusConfirmed: true,
          statusSourceBatchId: "legacy",
          dualStatus: null,
          statusSourceA: null,
          statusSourceB: null,
          updatedAt: Date.now()
        };
        count++;
      }
      this.migrated = true;
      this.pushLog(`迁移完成：${count} 个站点已迁入新台账，来源标记为「历史数据迁移」`);
      this.recalcStats();
      this.persist();
    },

    ensureSite(name: string, area: string, manager: string): Site {
      let site = this.sites.find((s) => s.name === name);
      if (!site) {
        site = {
          id: uuid(),
          name,
          area,
          manager,
          frozen: false,
          createdAt: Date.now()
        };
        this.sites.push(site);
      } else {
        if (area) site.area = area;
        if (manager) site.manager = manager;
      }
      return site;
    },

    // ---------- 导入（批次入队，按读取时间排队） ----------
    importText(sourceName: string, text: string): { ok: boolean; duplicate?: boolean; count?: number } {
      const hash = hashContent(text);
      if (this.batches.some((b) => b.sourceHash === hash)) {
        this.pushLog(`重复导入：「${sourceName}」内容已存在，未新增记录`);
        return { ok: false, duplicate: true };
      }
      const rows = parseCsv(text);
      if (rows.length === 0) {
        this.pushLog(`导入失败：「${sourceName}」无有效数据行`);
        return { ok: false };
      }
      const readAt = Date.now();
      const sourceAt = rows.reduce<number | null>((acc, r) => {
        if (r.sourceAt == null) return acc;
        return acc == null ? r.sourceAt : Math.max(acc, r.sourceAt);
      }, null);
      const batch: Batch = {
        id: uuid(),
        sourceName,
        sourceHash: hash,
        readAt,
        sourceAt,
        status: "queued",
        recordCount: rows.length,
        writtenCount: 0,
        failedCount: 0,
        conflictCount: 0,
        createdAt: readAt
      };
      for (const r of rows) {
        const site = this.ensureSite(r.station, r.area, r.manager);
        this.records.push({
          id: uuid(),
          batchId: batch.id,
          siteId: site.id,
          siteName: site.name,
          area: r.area,
          stock: r.stock,
          businessStatus: r.status,
          manager: r.manager,
          sourceAt: r.sourceAt,
          writeStatus: "pending",
          failReason: null
        });
      }
      this.batches.push(batch);
      this.pushLog(`已读取「${sourceName}」：${rows.length} 个站点，按读取时间排队（#${this.batches.length}）`);
      this.persist();
      void this.processQueue();
      return { ok: true, count: rows.length };
    },

    async processQueue() {
      if (this.processing) return;
      this.processing = true;
      try {
        const queue = [...this.batches]
          .filter((b) => b.status === "queued" || b.status === "partial")
          .sort((a, b) => a.readAt - b.readAt);
        for (const batch of queue) {
          await this.processBatch(batch.id, { isRetry: false });
        }
      } finally {
        this.processing = false;
        this.persist();
      }
    },

    /** 处理单个批次。isRetry=true 时不注入演示失败，仅重试未成功站点。 */
    async processBatch(batchId: string, opts: { isRetry: boolean }) {
      const batch = this.batches.find((b) => b.id === batchId);
      if (!batch) return;
      const firstPass = batch.status === "queued"; // 仅首次处理注入演示失败
      batch.status = "processing";
      const records = this.records.filter((r) => r.batchId === batchId);
      const baseTime = batch.sourceAt ?? batch.readAt;

      for (const rec of records) {
        // 已写入的站点留住，不重复写
        if (rec.writeStatus === "written") continue;
        // 冲突挂起的站点不在批次内重写
        if (rec.writeStatus === "conflict") continue;

        const site = this.sites.find((s) => s.id === rec.siteId);
        if (!site) continue;

        // 站点冻结：跳过，记为 blocked，待解冻后续作
        if (site.frozen) {
          rec.writeStatus = "blocked";
          rec.failReason = "站点冻结中，等待冲突处理";
          continue;
        }

        // 演示失败注入：仅在批次首次处理时，对第一个待写入站点生效
        const firstPending = records.find(
          (r) => r.writeStatus === "pending" || r.writeStatus === "blocked" || r.writeStatus === "failed"
        );
        if (
          firstPass &&
          !opts.isRetry &&
          this.simulateFailure &&
          rec.id === firstPending?.id
        ) {
          rec.writeStatus = "failed";
          rec.failReason = "写入超时（演示）";
          this.pushLog(`「${batch.sourceName}」站点 ${rec.siteName} 写入失败：${rec.failReason}`);
          continue;
        }

        this.applyRecord(rec, batch, baseTime);
      }

      // 汇总批次状态
      const failed = records.filter((r) => r.writeStatus === "failed").length;
      const blocked = records.filter((r) => r.writeStatus === "blocked").length;
      const conflict = records.filter((r) => r.writeStatus === "conflict").length;
      const written = records.filter((r) => r.writeStatus === "written").length;
      batch.failedCount = failed;
      batch.conflictCount = conflict;
      batch.writtenCount = written;
      batch.status = failed > 0 || blocked > 0 ? "partial" : "done";
      this.recalcStats();
      this.persist();
    },

    /** 应用单条站点记录到台账：库存取较新来源，营业状态未确认留两版。 */
    applyRecord(rec: BatchRecord, batch: Batch, baseTime: number) {
      const site = this.sites.find((s) => s.id === rec.siteId);
      if (!site) return;
      const entry = this.ledger[rec.siteId];
      const recTime = rec.sourceAt ?? baseTime;

      if (!entry) {
        this.ledger[rec.siteId] = {
          siteId: rec.siteId,
          stock: rec.stock,
          stockSourceBatchId: batch.id,
          stockSourceAt: recTime,
          businessStatus: rec.businessStatus,
          statusConfirmed: true,
          statusSourceBatchId: batch.id,
          dualStatus: null,
          statusSourceA: null,
          statusSourceB: null,
          updatedAt: Date.now()
        };
        rec.writeStatus = "written";
        rec.failReason = null;
        return;
      }

      // 库存：同站点取来源较新者
      if (recTime >= (entry.stockSourceAt ?? 0)) {
        entry.stock = rec.stock;
        entry.stockSourceBatchId = batch.id;
        entry.stockSourceAt = recTime;
      }

      // 营业状态：已确认且与当前不同 → 留两版 + 冻结 + 冲突进台账
      if (entry.statusConfirmed && entry.businessStatus !== rec.businessStatus) {
        const statusSourceAt = entry.statusSourceBatchId === "legacy" ? 0 : (entry.stockSourceAt ?? 0);
        const olderIsA = statusSourceAt <= recTime;
        const aStatus = olderIsA ? entry.businessStatus : rec.businessStatus;
        const bStatus = olderIsA ? rec.businessStatus : entry.businessStatus;
        const aBatch = olderIsA ? entry.statusSourceBatchId : batch.id;
        const bBatch = olderIsA ? batch.id : entry.statusSourceBatchId;

        entry.businessStatus = "待确认（两版）";
        entry.statusConfirmed = false;
        entry.dualStatus = { a: aStatus, b: bStatus };
        entry.statusSourceA = aBatch;
        entry.statusSourceB = bBatch;
        entry.statusSourceBatchId = null;

        site.frozen = true;
        rec.writeStatus = "conflict";
        rec.failReason = null;

        this.conflicts.push({
          id: uuid(),
          siteId: site.id,
          siteName: site.name,
          batchAId: aBatch ?? "legacy",
          batchBId: bBatch ?? "legacy",
          field: "businessStatus",
          valueA: aStatus,
          valueB: bStatus,
          status: "pending",
          proposal: null,
          ownerId: this.currentUser.name,
          handledBy: null,
          approvedBy: null,
          createdAt: Date.now(),
          handledAt: null,
          approvedAt: null
        });
        this.pushLog(
          `站点 ${site.name} 营业状态冲突：${aStatus}（旧）↔ ${bStatus}（新），已冻结并进入冲突台账`
        );
        return;
      }

      // 状态一致：若来源较新，更新状态来源批次
      if (recTime >= (entry.stockSourceAt ?? 0)) {
        entry.statusSourceBatchId = batch.id;
      }
      entry.updatedAt = Date.now();
      rec.writeStatus = "written";
      rec.failReason = null;
    },

    /** 续作：重试所有失败/挂起站点，已写入的留住 */
    async resume() {
      const targets = this.batches
        .filter((b) => b.status === "partial" || b.status === "queued")
        .sort((a, b) => a.readAt - b.readAt);
      if (targets.length === 0) {
        this.pushLog("没有需要续作的批次");
        return;
      }
      this.pushLog(`开始续作：${targets.length} 个批次，仅重试未成功站点`);
      for (const batch of targets) {
        await this.processBatch(batch.id, { isRetry: true });
      }
      this.processing = false;
      this.persist();
    },

    // ---------- 冲突处理（员工：处理自己的冲突） ----------
    handleConflict(conflictId: string, proposal: Proposal) {
      const c = this.conflicts.find((x) => x.id === conflictId);
      if (!c) return;
      if (this.currentUser.role !== "employee") {
        this.reject("处理冲突（仅归属员工）");
        return;
      }
      if (c.ownerId !== this.currentUser.name) {
        this.reject(`处理他人冲突（归属：${c.ownerId}）`);
        return;
      }
      if (c.status !== "pending") {
        this.pushLog(`冲突 ${c.siteName} 当前状态不可处理（${c.status}）`);
        return;
      }
      c.proposal = proposal;
      c.status = "handled";
      c.handledBy = this.currentUser.name;
      c.handledAt = Date.now();
      this.pushLog(
        `员工 ${this.currentUser.name} 已处理 ${c.siteName} 冲突，建议${
          proposal === "A" ? "采用旧版" : proposal === "B" ? "采用新版" : "保持两版"
        }，待调度员批准`
      );
      this.persist();
    },

    // ---------- 批准合并（调度员） ----------
    approveMerge(conflictId: string) {
      const c = this.conflicts.find((x) => x.id === conflictId);
      if (!c) return;
      if (this.currentUser.role !== "dispatcher") {
        this.reject("批准合并（仅调度员）");
        return;
      }
      if (c.status !== "handled" || !c.proposal) {
        this.pushLog(`冲突 ${c.siteName} 尚未经员工处理，不能批准合并`);
        return;
      }
      const entry = this.ledger[c.siteId];
      if (entry) {
        if (c.proposal === "A") {
          entry.businessStatus = c.valueA;
          entry.statusConfirmed = true;
          entry.dualStatus = null;
          entry.statusSourceBatchId = c.batchAId;
          entry.statusSourceA = null;
          entry.statusSourceB = null;
        } else if (c.proposal === "B") {
          entry.businessStatus = c.valueB;
          entry.statusConfirmed = true;
          entry.dualStatus = null;
          entry.statusSourceBatchId = c.batchBId;
          entry.statusSourceA = null;
          entry.statusSourceB = null;
        } else {
          entry.businessStatus = "两版并存";
          entry.statusConfirmed = true;
          entry.dualStatus = { a: c.valueA, b: c.valueB };
          entry.statusSourceBatchId = null;
        }
        entry.updatedAt = Date.now();
      }
      c.status = "resolved";
      c.approvedBy = this.currentUser.name;
      c.approvedAt = Date.now();

      // 该站点无未决冲突 → 解冻并重算
      const stillActive = this.conflicts.some(
        (x) => x.siteId === c.siteId && (x.status === "pending" || x.status === "handled")
      );
      const site = this.sites.find((s) => s.id === c.siteId);
      if (site && !stillActive) site.frozen = false;
      this.recalcStats();
      this.pushLog(
        `调度员 ${this.currentUser.name} 已批准 ${c.siteName} 合并（${
          c.proposal === "A" ? "采用旧版" : c.proposal === "B" ? "采用新版" : "两版并存"
        }），站点已解冻并重算统计`
      );
      this.persist();
    },

    // ---------- 回滚（调度员） ----------
    rollback(conflictId: string) {
      const c = this.conflicts.find((x) => x.id === conflictId);
      if (!c) return;
      if (this.currentUser.role !== "dispatcher") {
        this.reject("回滚合并（仅调度员）");
        return;
      }
      if (c.status !== "resolved") {
        this.pushLog(`仅已批准的合并可回滚（当前：${c.status}）`);
        return;
      }
      const entry = this.ledger[c.siteId];
      if (entry) {
        entry.businessStatus = "待确认（两版）";
        entry.statusConfirmed = false;
        entry.dualStatus = { a: c.valueA, b: c.valueB };
        entry.statusSourceBatchId = null;
        entry.updatedAt = Date.now();
      }
      c.status = "pending";
      c.approvedBy = null;
      c.approvedAt = null;
      const site = this.sites.find((s) => s.id === c.siteId);
      if (site) site.frozen = true;
      this.recalcStats();
      this.pushLog(`调度员 ${this.currentUser.name} 已回滚 ${c.siteName} 合并，恢复两版未确认，站点重新冻结`);
      this.persist();
    },

    // ---------- 统计 ----------
    recalcStats() {
      const entries = Object.values(this.ledger);
      const frozen = this.sites.filter((s) => s.frozen).length;
      this.stats = {
        siteCount: this.sites.length,
        openCount: entries.filter((e) => e.businessStatus === "营业中").length,
        lowStockCount: entries.filter((e) => e.businessStatus === "库存紧张").length,
        totalStock: entries.reduce((acc, e) => acc + (Number(e.stock) || 0), 0),
        frozenCount: frozen,
        conflictCount: this.conflicts.filter((c) => c.status === "pending" || c.status === "handled").length,
        recalculatedAt: frozen === 0 ? Date.now() : this.stats.recalculatedAt
      };
    },

    manualRecalc() {
      if (this.sites.some((s) => s.frozen)) {
        this.pushLog("存在冻结站点，统计将在冲突处理完成、站点解冻后重算");
        return;
      }
      this.recalcStats();
      this.pushLog("已重新统计台账");
      this.persist();
    },

    resetAll() {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      this.$reset();
      this.log = [];
      this.migrateIfNeeded();
    }
  }
});
