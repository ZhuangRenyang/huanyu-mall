/**
 * 顾客端发票申请（ADR-098，淘宝「申请开票」）。
 *
 * 只提交抬头信息，**金额由服务端取订单总额**——顾客不能填金额。
 * 提交后是「待开票」：商家线下开票、后台登记发票号，顾客再回来就能看到号码。
 */
import { getApiMode, getStoreClient } from './api';

export type StoreInvoiceType = 'personal' | 'company';
export type StoreInvoiceStatus = 'pending' | 'issued' | 'rejected';

export interface StoreInvoiceView {
  id: string;
  type: StoreInvoiceType;
  /** 发票抬头。 */
  title: string;
  taxId: string | null;
  email: string;
  amountMinor: number;
  currencyCode: string;
  remark: string | null;
  status: StoreInvoiceStatus;
  /** 商家登记的发票号码；未开票为空。 */
  invoiceNo: string | null;
  issuedAt: string | null;
  /** 拒绝原因。 */
  reviewNote: string | null;
  createdAt: string;
}

interface RawInvoice {
  id?: string;
  type?: string;
  title?: string;
  tax_id?: string | null;
  email?: string;
  amount_minor?: number | string;
  currency_code?: string;
  remark?: string | null;
  status?: string;
  invoice_no?: string | null;
  issued_at?: string | null;
  review_note?: string | null;
  created_at?: string;
}

function mapInvoice(r: RawInvoice): StoreInvoiceView {
  return {
    id: String(r.id ?? ''),
    type: r.type === 'company' ? 'company' : 'personal',
    title: String(r.title ?? ''),
    taxId: r.tax_id ?? null,
    email: String(r.email ?? ''),
    amountMinor: Number(r.amount_minor ?? 0),
    currencyCode: String(r.currency_code ?? 'CNY'),
    remark: r.remark ?? null,
    status:
      r.status === 'issued' ? 'issued' : r.status === 'rejected' ? 'rejected' : 'pending',
    invoiceNo: r.invoice_no ?? null,
    issuedAt: r.issued_at ?? null,
    reviewNote: r.review_note ?? null,
    createdAt: String(r.created_at ?? ''),
  };
}

/** 该订单的开票进度；没申请过返回 null。查不到不挡订单页。 */
export async function loadOrderInvoice(orderId: string): Promise<StoreInvoiceView | null> {
  if (getApiMode() !== 'live') return null;
  try {
    const res = (await getStoreClient().getOrderInvoice(orderId)) as RawInvoice | null;
    return res && res.id ? mapInvoice(res) : null;
  } catch {
    return null;
  }
}

export interface InvoiceRequestInput {
  type: StoreInvoiceType;
  title: string;
  /** 企业必填。 */
  taxId?: string;
  /** 收票邮箱；不填用订单邮箱。 */
  email?: string;
  remark?: string;
}

export async function requestOrderInvoice(
  orderId: string,
  input: InvoiceRequestInput,
): Promise<void> {
  if (getApiMode() !== 'live') {
    throw new Error('演示模式无法提交开票申请，请在正式环境操作');
  }
  await getStoreClient().requestOrderInvoice(orderId, {
    type: input.type,
    title: input.title,
    ...(input.taxId?.trim() ? { tax_id: input.taxId.trim() } : {}),
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    ...(input.remark?.trim() ? { remark: input.remark.trim() } : {}),
  });
}
