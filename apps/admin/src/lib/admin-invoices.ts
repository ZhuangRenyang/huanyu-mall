import { adminClient, getAdminApiMode } from './admin-client';
import {
  issueInvoice as mockIssueInvoice,
  listInvoices as mockListInvoices,
  rejectInvoice as mockRejectInvoice,
} from './admin-store';

/**
 * 发票管理数据层（ADR-098，对齐淘宝「交易 → 发票管理」）。
 *
 * 与退款管理同一套路：mock 走 localStorage，live 走 SDK；
 * 金额一律由后端算好下发，前端只格式化（铁律 13）。
 */
export type InvoiceType = 'personal' | 'company';
export type InvoiceStatus = 'pending' | 'issued' | 'rejected';

export interface InvoiceView {
  id: string;
  orderId: string;
  type: InvoiceType;
  /** 发票抬头。 */
  title: string;
  /** 企业税号；个人为空。 */
  taxId: string | null;
  email: string;
  amountMinor: number;
  currencyCode: string;
  remark: string | null;
  status: InvoiceStatus;
  /** 已登记的发票号码。 */
  invoiceNo: string | null;
  issuedAt: string | null;
  /** 商家处理说明（拒绝原因）。 */
  reviewNote: string | null;
  createdAt: string;
}

export interface InvoiceCounts {
  pending: number;
  issued: number;
  rejected: number;
  all: number;
}

export interface InvoiceListResult {
  items: InvoiceView[];
  total: number;
  counts: InvoiceCounts;
}

export const EMPTY_INVOICE_RESULT: InvoiceListResult = {
  items: [],
  total: 0,
  counts: { pending: 0, issued: 0, rejected: 0, all: 0 },
};

function mapInvoice(i: Record<string, unknown>): InvoiceView {
  return {
    id: String(i.id ?? ''),
    orderId: String(i.order_id ?? ''),
    type: i.type === 'company' ? 'company' : 'personal',
    title: String(i.title ?? ''),
    taxId: (i.tax_id as string | null) ?? null,
    email: String(i.email ?? ''),
    amountMinor: Number(i.amount_minor ?? 0),
    currencyCode: String(i.currency_code ?? 'CNY'),
    remark: (i.remark as string | null) ?? null,
    status: (i.status as InvoiceStatus) ?? 'pending',
    invoiceNo: (i.invoice_no as string | null) ?? null,
    issuedAt: (i.issued_at as string | null) ?? null,
    reviewNote: (i.review_note as string | null) ?? null,
    createdAt: String(i.created_at ?? ''),
  };
}

export async function listInvoices(q: {
  status?: InvoiceStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<InvoiceListResult> {
  if (getAdminApiMode() !== 'live') {
    const all = mockListInvoices(q.status);
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;
    const count = (s: InvoiceStatus) => mockListInvoices(s).length;
    return {
      items: all.slice(offset, offset + limit),
      total: all.length,
      counts: {
        pending: count('pending'),
        issued: count('issued'),
        rejected: count('rejected'),
        all: mockListInvoices().length,
      },
    };
  }
  const res = (await adminClient().listInvoices({
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    ...(q.status ? { status: q.status } : {}),
  })) as {
    items?: Array<Record<string, unknown>>;
    count?: number;
    counts?: Partial<InvoiceCounts>;
  };
  return {
    items: (res.items ?? []).map(mapInvoice),
    total: res.count ?? 0,
    counts: { ...EMPTY_INVOICE_RESULT.counts, ...(res.counts ?? {}) },
  };
}

/** 登记开票：只写发票号，不动钱、不动订单状态。 */
export async function issueInvoice(id: string, invoiceNo: string, note?: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockIssueInvoice(id, invoiceNo, note);
    return;
  }
  await adminClient().issueInvoice(id, note ? { invoice_no: invoiceNo, note } : { invoice_no: invoiceNo });
}

/** 拒绝开票：原因必填（顾客要看到为什么开不了）。 */
export async function rejectInvoice(id: string, note: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockRejectInvoice(id, note);
    return;
  }
  await adminClient().rejectInvoice(id, { note });
}
