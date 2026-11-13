/**
 * CSV 生成（ADR-057：订单导出）。
 *
 * 手写而不是引库：只需要「一个二维数组变 CSV」，而 Excel 兼容性靠的是两条纪律
 * （BOM + 正确的引号转义），不是靠库的代码量。
 *
 * 两个必须做对的地方：
 * 1. **转义**：含逗号、双引号、换行的字段必须整体包引号，内部引号翻倍。
 *    漏一条，一行就裂成两列或多行，商家按列对账会全部错位。
 * 2. **CSV 注入**：以 = + - @ 开头的单元格会被 Excel 当公式执行。
 *    内容来自顾客（留言、地址），不能让它变成公式 —— 前面加一个单引号。
 */

/** Excel 打开 UTF-8 CSV 需要 BOM，否则中文全是乱码。 */
export const UTF8_BOM = "\uFEFF";

const ROW_SEP = "\r\n";

/**
 * 单元格转义。
 *
 * 首尾空白也要包引号：否则 Excel 会把 `" 张三"` 的前导空格吃掉，
 * 而对账时「有空格/没空格」是不同的账号。
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // 公式注入：Excel/Sheets 会执行这些前缀后面的内容
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const needsQuote =
    /[",\r\n]/.test(text) || text !== text.trim();
  if (!needsQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** 二维数组 → CSV 文本（含 BOM，行尾 CRLF 以兼容 Excel）。 */
export function toCsv(rows: unknown[][]): string {
  return UTF8_BOM + rows.map((r) => r.map(csvCell).join(",")).join(ROW_SEP) + ROW_SEP;
}

/**
 * 金额（minor unit）→ 带两位小数的字符串。
 *
 * 导出给财务看的必须是「元」，不是分；但**不做四舍五入的取整**
 * （有些币种最小单位就是 1），只把 minor 除以 100 并保留两位。
 */
export function moneyCell(minor: bigint | number, currency: string): string {
  const n = typeof minor === "bigint" ? minor : BigInt(Math.round(minor));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac} ${currency}`;
}

/** 时间 → 本地 `YYYY-MM-DD HH:mm`（导出给人看，不带时区后缀）。 */
export function timeCell(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
