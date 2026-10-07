import type { BusinessStatus } from "../types";

/** 极简 CSV 解析：支持双引号包裹、逗号转义、首行表头，兼容 BOM */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) records.push(row);
  }

  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  return records.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()]))
  );
}

const VALID_STATUS: readonly BusinessStatus[] = ["营业中", "暂停营业", "库存紧张"];

export function isValidStatus(value: string): value is BusinessStatus {
  return (VALID_STATUS as readonly string[]).includes(value);
}

export interface ParsedRow {
  stationName: string;
  area: string;
  stock: number;
  status: BusinessStatus;
  snapshotTime: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: { line: number; reason: string; raw: string }[];
}

/** 解析盘点 CSV：表头须含 站点名称,区域,库存L,营业状态,盘点时间 */
export function parseInventoryCsv(text: string): ParseResult {
  const rawRows = parseCsv(text);
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];

  rawRows.forEach((raw, i) => {
    const line = i + 2;
    const stationName = raw["站点名称"] ?? "";
    const area = raw["区域"] ?? "";
    const stockText = raw["库存L"] ?? "";
    const status = raw["营业状态"] ?? "";
    const timeText = raw["盘点时间"] ?? "";
    const stock = Number(stockText);
    const snapshotTime = Date.parse(timeText.replace(/-/g, "/"));

    const rawSummary = `${stationName},${area},${stockText},${status},${timeText}`;
    if (!stationName || !area) {
      errors.push({ line, reason: "站点名称/区域不能为空", raw: rawSummary });
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      errors.push({ line, reason: "库存必须是非负数字", raw: rawSummary });
      return;
    }
    if (!isValidStatus(status)) {
      errors.push({ line, reason: `营业状态非法（允许：${VALID_STATUS.join("/")}）`, raw: rawSummary });
      return;
    }
    if (!Number.isFinite(snapshotTime)) {
      errors.push({ line, reason: "盘点时间无法解析", raw: rawSummary });
      return;
    }
    rows.push({ stationName, area, stock, status, snapshotTime });
  });

  return { rows, errors };
}

/** 32 位内容指纹（FNV-1a 的字符串变体，本地去重足够） */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
