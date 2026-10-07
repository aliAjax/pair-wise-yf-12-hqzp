// CSV 解析与内容哈希（纯前端，无外部依赖）

export interface ParsedRow {
  station: string;
  area: string;
  stock: number;
  status: string;
  manager: string;
  sourceAt: number | null; // 盘点时间（可选列）
}

/** 解析 CSV 文本为行记录。支持引号、逗号、换行转义。 */
export function parseCsv(text: string): ParsedRow[] {
  const lines = splitLines(text.replace(/^﻿/, ""));
  if (lines.length === 0) return [];

  const header = splitRow(lines[0]).map((h) => h.trim());
  const col = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));

  const iStation = col(["油站名称", "站名", "站点", "station"]);
  const iArea = col(["区域", "area"]);
  const iStock = col(["库存", "stock"]);
  const iStatus = col(["营业状态", "状态", "status"]);
  const iManager = col(["负责人", "manager"]);
  const iTime = col(["盘点时间", "时间", "date", "time"]);

  const rows: ParsedRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitRow(lines[li]);
    if (cells.length === 0 || cells.every((c) => c.trim() === "")) continue;
    const get = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : "");
    const station = get(iStation);
    if (!station) continue;
    const stockRaw = get(iStock).replace(/[,，\s]/g, "");
    const stock = Number(stockRaw) || 0;
    const timeRaw = get(iTime);
    const sourceAt = timeRaw ? Date.parse(timeRaw) : NaN;
    rows.push({
      station,
      area: get(iArea),
      stock,
      status: get(iStatus) || "营业中",
      manager: get(iManager),
      sourceAt: Number.isFinite(sourceAt) ? sourceAt : null
    });
  }
  return rows;
}

function splitLines(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** 简单稳定哈希（FNV-1a），用于重复导入去重。 */
export function hashContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 生成示例盘点 CSV（两批，含同站点库存差异与营业状态冲突）。 */
export function sampleCsv(kind: "a" | "b"): string {
  if (kind === "a") {
    return [
      "油站名称,区域,库存,营业状态,负责人,盘点时间",
      "东区一站,东区,36000,营业中,刘站长,2026-10-01 08:00",
      "机场快线站,机场线,9000,库存紧张,王站长,2026-10-01 08:05",
      "西区二站,西区,22000,营业中,陈站长,2026-10-01 08:10"
    ].join("\n");
  }
  return [
    "油站名称,区域,库存,营业状态,负责人,盘点时间",
    "东区一站,东区,35200,暂停营业,刘站长,2026-10-02 09:00",
    "机场快线站,机场线,12000,营业中,王站长,2026-10-02 09:05",
    "西区二站,西区,21500,营业中,陈站长,2026-10-02 09:10"
  ].join("\n");
}
