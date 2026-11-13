import { formatMinor } from "./money.js";
import type {
  OrderConfirmationPayload,
  ShipmentNotificationPayload,
  StockAlertPayload,
} from "../types.js";

/**
 * 邮件模板（ADR-016）。
 *
 * 三条硬要求：
 * 1. 邮件安全的 HTML——table 布局、行内样式、无外部资源、最大宽 600px；
 *    邮件客户端不支持现代 CSS，写了也白写，还会被 Outlook 拆掉。
 * 2. 所有来自订单/用户的数据必须转义：商品标题、地址、运单号都是用户可控内容。
 * 3. 同时产出纯文本版：读屏、纯文本客户端、被拦下的 HTML 都靠它。
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(opts: { title: string; intro: string; rows: string; footer: string }): string {
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px">',
    "<tr><td>",
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e5e5">',
    '<tr><td style="padding:24px 28px 8px">',
    `<h1 style="margin:0;font-size:20px;line-height:28px;color:#111111;font-weight:600">${escapeHtml(opts.title)}</h1>`,
    `<p style="margin:8px 0 0;font-size:14px;line-height:22px;color:#444444">${escapeHtml(opts.intro)}</p>`,
    "</td></tr>",
    `<tr><td style="padding:8px 28px">${opts.rows}</td></tr>`,
    '<tr><td style="padding:16px 28px 24px;border-top:1px solid #e5e5e5">',
    `<p style="margin:0;font-size:12px;line-height:20px;color:#666666">${opts.footer}</p>`,
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
  ].join("");
}

function kvRows(pairs: Array<[string, string]>): string {
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0">',
    ...pairs.map(
      ([k, v]) =>
        `<tr><td style="padding:4px 0;font-size:13px;line-height:20px;color:#666666;width:96px;vertical-align:top">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;font-size:13px;line-height:20px;color:#111111">${escapeHtml(v)}</td></tr>`,
    ),
    "</table>",
  ].join("");
}

function itemRows(
  items: Array<{ title: string; quantity: number; right: string }>,
): string {
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border-top:1px solid #e5e5e5">',
    ...items.map(
      (it) =>
        `<tr><td style="padding:10px 0;font-size:13px;line-height:20px;color:#111111;border-bottom:1px solid #f0f0f0">` +
        `${escapeHtml(it.title)}<span style="color:#666666"> × ${it.quantity}</span></td>` +
        `<td style="padding:10px 0;font-size:13px;line-height:20px;color:#111111;text-align:right;white-space:nowrap;border-bottom:1px solid #f0f0f0">${escapeHtml(it.right)}</td></tr>`,
    ),
    "</table>",
  ].join("");
}

function totalRows(pairs: Array<[string, string]>): string {
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px">',
    ...pairs.map(([k, v], i) => {
      const strong = i === pairs.length - 1;
      return (
        `<tr><td style="padding:3px 0;font-size:13px;line-height:20px;color:#666666;text-align:right">${escapeHtml(k)}</td>` +
        `<td style="padding:3px 0 0 16px;font-size:${strong ? 15 : 13}px;line-height:20px;color:#111111;text-align:right;white-space:nowrap${strong ? ";font-weight:600" : ""}">${escapeHtml(v)}</td></tr>`
      );
    }),
    "</table>",
  ].join("");
}

const ADDRESS_KEYS: Array<[string, string]> = [
  ["收件人", "name"],
  ["电话", "phone"],
  ["地址", "address_1"],
  ["地址2", "address_2"],
  ["城市", "city"],
  ["省/州", "province"],
  ["邮编", "postal_code"],
  ["国家", "country_code"],
];

function addressLines(addr: Record<string, unknown>): string {
  return ADDRESS_KEYS.map(([, key]) => String(addr[key] ?? "").trim())
    .filter(Boolean)
    .join("　");
}

function addressPairs(addr: Record<string, unknown>): Array<[string, string]> {
  return ADDRESS_KEYS.map(([label, key]) => [label, String(addr[key] ?? "").trim()] as [string, string]).filter(
    ([, v]) => v.length > 0,
  );
}

function footerLine(opts: { fromName: string; storefrontUrl: string }): string {
  const base = `此邮件由系统自动发送，请勿直接回复。${opts.fromName}`;
  return opts.storefrontUrl ? `${escapeHtml(base)}｜<a href="${escapeHtml(opts.storefrontUrl)}" style="color:#1666d9;text-decoration:none">查看订单</a>` : escapeHtml(base);
}

export function renderOrderConfirmation(
  payload: OrderConfirmationPayload,
  opts: { fromName: string; storefrontUrl: string },
): RenderedEmail {
  const c = payload.currencyCode;
  const subject = `订单已确认 · ${payload.orderNumber}`;
  const itemsHtml = itemRows(
    payload.items.map((it) => ({
      title: it.title,
      quantity: it.quantity,
      right: formatMinor(it.totalMinor, c),
    })),
  );
  const totals: Array<[string, string]> = [
    ["商品", formatMinor(payload.subtotalMinor, c)],
  ];
  if (payload.discountMinor > 0) totals.push(["优惠", `-${formatMinor(payload.discountMinor, c)}`]);
  totals.push(["运费", formatMinor(payload.shippingMinor, c)]);
  if (payload.taxMinor > 0) totals.push(["税", formatMinor(payload.taxMinor, c)]);
  totals.push(["应付", formatMinor(payload.totalMinor, c)]);

  const html = shell({
    title: "订单已确认",
    intro: `订单 ${payload.orderNumber} 已收到，我们会尽快为你发货。`,
    rows: [
      itemsHtml,
      totalRows(totals),
      kvRows([
        ["收货信息", addressLines(payload.shippingAddress) || "（未填写）"],
        ["订单号", payload.orderNumber],
      ]),
    ].join(""),
    footer: footerLine(opts),
  });

  const text = [
    `订单已确认 · ${payload.orderNumber}`,
    `订单 ${payload.orderNumber} 已收到，我们会尽快为你发货。`,
    "",
    ...payload.items.map((it) => `- ${it.title} × ${it.quantity}  ${formatMinor(it.totalMinor, c)}`),
    "",
    `商品：${formatMinor(payload.subtotalMinor, c)}`,
    ...(payload.discountMinor > 0 ? [`优惠：-${formatMinor(payload.discountMinor, c)}`] : []),
    `运费：${formatMinor(payload.shippingMinor, c)}`,
    ...(payload.taxMinor > 0 ? [`税：${formatMinor(payload.taxMinor, c)}`] : []),
    `应付：${formatMinor(payload.totalMinor, c)}`,
    "",
    `收货信息：${addressLines(payload.shippingAddress) || "（未填写）"}`,
    `订单号：${payload.orderNumber}`,
    "",
    opts.storefrontUrl ? `查看订单：${opts.storefrontUrl}` : "",
    `此邮件由系统自动发送，请勿直接回复。${opts.fromName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

export function renderShipmentNotification(
  payload: ShipmentNotificationPayload,
  opts: { fromName: string; storefrontUrl: string },
): RenderedEmail {
  const subject = `订单 ${payload.orderNumber} 已发货`;
  const html = shell({
    title: "订单已发货",
    intro: `订单 ${payload.orderNumber} 已从仓库发出，请留意查收。`,
    rows: [
      kvRows([
        ["承运商", payload.carrier],
        ["运单号", payload.trackingNumber],
        ["发货时间", payload.shippedAt],
      ]),
      itemRows(payload.items.map((it) => ({ title: it.title, quantity: it.quantity, right: "" }))),
    ].join(""),
    footer: footerLine(opts),
  });

  const text = [
    `订单 ${payload.orderNumber} 已发货`,
    `订单 ${payload.orderNumber} 已从仓库发出，请留意查收。`,
    "",
    `承运商：${payload.carrier}`,
    `运单号：${payload.trackingNumber}`,
    `发货时间：${payload.shippedAt}`,
    "",
    ...payload.items.map((it) => `- ${it.title} × ${it.quantity}`),
    "",
    opts.storefrontUrl ? `查看订单：${opts.storefrontUrl}` : "",
    `此邮件由系统自动发送，请勿直接回复。${opts.fromName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

/**
 * 到货提醒（ADR-059）。
 *
 * 只写「回来了、去哪买」，不写价格：补货后价格可能调过，
 * 邮件里印一个旧价，顾客点进去看到不一致，比不发还伤。
 */
export function renderStockAlert(
  payload: StockAlertPayload,
  opts: { fromName: string; storefrontUrl: string },
): RenderedEmail {
  const variant = payload.variantTitle ? `（${payload.variantTitle}）` : "";
  const subject = `你等的「${payload.productTitle}」到货了`;
  const html = shell({
    title: "到货了",
    intro: `你登记提醒的「${payload.productTitle}」${variant}已经补货，现货有限，先到先得。`,
    rows: [
      kvRows([["商品", `${payload.productTitle}${variant}`]]),
      opts.storefrontUrl
        ? `<p style="margin:16px 0"><a href="${escapeHtml(opts.storefrontUrl)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">去店铺看看</a></p>`
        : "",
    ].join(""),
    footer: footerLine(opts),
  });

  const text = [
    `你等的「${payload.productTitle}」到货了`,
    `「${payload.productTitle}」${variant}已经补货，现货有限，先到先得。`,
    "",
    opts.storefrontUrl ? `去店铺看看：${opts.storefrontUrl}` : "",
    `此邮件由系统自动发送，请勿直接回复。${opts.fromName}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}
