import { adminClient, getAdminApiMode } from './admin-client';

/**
 * 会员标签数据层（ADR-103）。
 *
 * 标签是多对多：一个客户可以有多个标签。分组不做 —— 分组折扣与会员等级折扣
 * 语义重叠，两个都做会出现「同一件商品按哪个折扣」。
 */
export interface CustomerTagView {
  id: string;
  name: string;
  /** 带这个标签的客户数。 */
  customerCount: number;
}

export async function listCustomerTags(): Promise<CustomerTagView[]> {
  if (getAdminApiMode() !== 'live') {
    return MOCK_TAGS;
  }
  const res = (await adminClient().listCustomerTags()) as {
    items?: Array<Record<string, unknown>>;
  };
  return (res.items ?? []).map((t) => ({
    id: String(t.id ?? ''),
    name: String(t.name ?? ''),
    customerCount: Number(t.customer_count ?? 0),
  }));
}

export async function createCustomerTag(name: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    MOCK_TAGS.push({ id: `tag_${MOCK_TAGS.length + 1}`, name, customerCount: 0 });
    return;
  }
  await adminClient().createCustomerTag({ name });
}

export async function deleteCustomerTag(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const i = MOCK_TAGS.findIndex((t) => t.id === id);
    if (i >= 0) MOCK_TAGS.splice(i, 1);
    return;
  }
  await adminClient().deleteCustomerTag(id);
}

/** 某客户身上的标签 id（打标对话框回填）。 */
export async function getCustomerTagIds(customerId: string): Promise<string[]> {
  if (getAdminApiMode() !== 'live') return [];
  const res = (await adminClient().getCustomerTags(customerId)) as {
    items?: Array<{ id?: string }>;
  };
  return (res.items ?? []).map((t) => String(t.id ?? ''));
}

/** 覆盖式设置客户标签。 */
export async function setCustomerTags(customerId: string, tagIds: string[]): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().setCustomerTags(customerId, { tag_ids: tagIds });
}

/** 演示模式的标签（模块级常量，新建后当次会话可见）。 */
const MOCK_TAGS: CustomerTagView[] = [
  { id: 'tag_1', name: '高价值', customerCount: 2 },
  { id: 'tag_2', name: '待回购', customerCount: 1 },
];
