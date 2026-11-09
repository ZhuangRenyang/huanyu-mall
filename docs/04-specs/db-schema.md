# DB Schema — 全球商城一期（字段级）

> 依据：Spec §6 表清单 + 架构 §2（模块契约）/ §4（links）/ §5（引擎内核）/ §7（API）/ §16（坑清单）
> 状态：Phase 2 字段级定稿，Phase 3 据此生成 Drizzle schema 与迁移 SQL
> 计数：14 个后端模块 = 63 张模块表；13 张 links 关联表；合计 76 张。内核 3 张表见 §16 交叉引用。

---

## 0. 通用字段规范（所有表默认遵守，见坑清单 §16）

| 规范项 | 规则 |
|---|---|
| 主键 | `id text`，ULID，带模块前缀（见下表）。不建自增 int、不用 uuid 类型（存成 text 便于跨模块 id 列无 FK 且可读） |
| 审计列 | 每表含 `created_at timestamptz NOT NULL DEFAULT now()`、`updated_at timestamptz NOT NULL DEFAULT now()`（应用层维护 updated_at） |
| 软删 | 可软删表另含 `deleted_at timestamptz NULL`；唯一索引一律带 `WHERE deleted_at IS NULL`（坑 4） |
| 金额 | `amount_minor bigint`（最小币种单位，int64，坑 1），配 `currency_code char(3)`；禁止 numeric/float 存金额 |
| 时间 | 一律 `timestamptz`，UTC 存储（坑 2） |
| 枚举 | 用 `text` + 说明里的枚举值，**不建 PG enum 类型**（便于增量迁移 add value，坑 7/ADR-009） |
| 外键 | 仅**模块内** FK；跨模块只存 id 列（text，无 REFERENCES），关系走 links（铁律 2） |
| 每表列说明 | 业务列见各表；上述 `id / created_at / updated_at`（及软删表的 `deleted_at`）不再逐表重复 |

### 0.1 ID 前缀表

| 前缀 | 实体 | 前缀 | 实体 |
|---|---|---|---|
| `prod_` | product | `var_` | product_variant |
| `pt_` | product_type | `pta_` | product_type_attribute |
| `attr_` | attribute | `attrv_` | attribute_value |
| `vav_` | variant_attribute_value | `pimg_` | product_image |
| `cat_` | product_category | `pcat_` | product_category_link |
| `pset_` | price_set | `prc_` | price |
| `pl_` | price_list | `plr_` | price_list_rule |
| `reg_` | region | `rc_` | region_country |
| `chn_` | channel | `chl_` | channel_locale |
| `cart_` | cart | `cli_` | cart_line_item |
| `clia_` | cart_line_item_adjustment | `csm_` | cart_shipping_method |
| `ord_` | order | `oli_` | order_line_item |
| `ois_` | order_item_snapshot | `osm_` | order_shipping_method |
| `osh_` | order_status_history | `paycol_` | payment_collection |
| `paysess_` | payment_session | `pay_` | payment |
| `paytxn_` | payment_transaction | `rfd_` | refund |
| `pp_` | payment_provider_config | `pwebhook_` | provider_webhook_event |
| `invitem_` | inventory_item | `loc_` | stock_location |
| `invlvl_` | inventory_level | `rsv_` | reservation_item |
| `shipzone_` | shipping_zone | `shipopt_` | shipping_option |
| `shiprule_` | shipping_option_price_rule | `fulf_` | fulfillment |
| `fulfitem_` | fulfillment_item | `ship_` | shipment |
| `taxrate_` | tax_rate | `taxr_` | tax_rate_rule |
| `cust_` | customer | `addr_` | customer_address |
| `custgrp_` | customer_group | `aid_` | auth_identity |
| `acrd_` | auth_credential | `pid_` | provider_identity |
| `rt_` | refresh_token | `adm_` | admin_user |
| `role_` | rbac_role | `ur_` | rbac_user_role |
| `evt_` | event_outbox | `subchk_` | subscriber_checkpoint |
| `dlq_` | job_dead_letter | `file_` | file |
| `filevar_` | file_variant | `theme_` | theme_settings |
| `themerev_` | theme_revision | `lnk_` | links 关联表 |

---

## 1. M01 Product（10 表）

### product
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| title | text | 否 | — | 商品名 |
| handle | text | 否 | — | URL slug，唯一（`WHERE deleted_at IS NULL`） |
| subtitle | text | 是 | — | 副标题 |
| description | text | 是 | — | 描述（富文本/纯文本） |
| status | text | 否 | `draft` | 枚举：draft / published / archived |
| thumbnail_file_id | text | 是 | — | 指向 file.id（M13，跨模块存 id） |
| product_type_id | text | 是 | — | FK → product_type.id（模块内） |
| metadata | jsonb | 是 | — | 扩展元数据 |
| search_vector | tsvector | 是 | — | 生成列：`to_tsvector('simple', title \|\| ' ' \|\| subtitle)`（架构 §6.4） |

索引：`UNIQUE (handle) WHERE deleted_at IS NULL`；`GIN (search_vector)`；`GIN (title gin_trgm_ops)`；`idx_product_status (status)`。软删。

### product_variant
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| product_id | text | 否 | — | FK → product.id |
| sku | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| title | text | 否 | — | 变体名 |
| options | jsonb | 否 | — | 规格键值对 `{attr_id: attr_value_id}` |
| barcode | text | 是 | — | 条码 |
| ean | text | 是 | — | EAN |
| weight_gram | int4 | 是 | — | 重量（克） |
| height_mm | int4 | 是 | — | 高 |
| width_mm | int4 | 是 | — | 宽 |
| length_mm | int4 | 是 | — | 长 |
| allow_backorder | bool | 否 | `false` | 是否允许负库存下单 |
| status | text | 否 | `draft` | 枚举：draft / published / archived |

索引：`UNIQUE (sku) WHERE deleted_at IS NULL`；`idx_variant_product (product_id)`。软删。

### product_type
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 类型名 |

软删。

### product_type_attribute
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| product_type_id | text | 否 | — | FK → product_type.id |
| attribute_id | text | 否 | — | FK → attribute.id |
| sort_order | int4 | 否 | `0` | 排序 |
| is_variant_attribute | bool | 否 | `false` | 是否规格属性（参与变体） |
| is_required | bool | 否 | `false` | 是否必填 |

索引：`UNIQUE (product_type_id, attribute_id) WHERE deleted_at IS NULL`。软删。

### attribute
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 属性名 |
| handle | text | 否 | — | 唯一 slug |
| input_type | text | 否 | — | 枚举：dropdown / multiselect / swatch / boolean / numeric / text |
| is_filterable | bool | 否 | `false` | 是否可筛选 |
| is_translatable | bool | 否 | `false` | 是否可翻译 |

索引：`UNIQUE (handle) WHERE deleted_at IS NULL`。软删。

### attribute_value
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| attribute_id | text | 否 | — | FK → attribute.id |
| value | text | 否 | — | 值（存储用） |
| label | text | 否 | — | 显示名 |
| sort_order | int4 | 否 | `0` | 排序 |

索引：`UNIQUE (attribute_id, value) WHERE deleted_at IS NULL`。软删。

### variant_attribute_value
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| variant_id | text | 否 | — | FK → product_variant.id |
| attribute_id | text | 否 | — | FK → attribute.id |
| attribute_value_id | text | 否 | — | FK → attribute_value.id |

索引：`UNIQUE (variant_id, attribute_id)`。无软删（随变体删除级联）。

### product_image
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| product_id | text | 否 | — | FK → product.id |
| file_id | text | 否 | — | 指向 file.id（跨模块存 id） |
| alt | text | 是 | — | alt 文案 |
| sort_order | int4 | 否 | `0` | 排序 |
| is_primary | bool | 否 | `false` | 主图 |

索引：`idx_pimg_product (product_id)`。软删。

### product_category
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 分类名 |
| handle | text | 否 | — | 唯一 slug |
| parent_id | text | 是 | — | FK → product_category.id（自引用） |
| sort_order | int4 | 否 | `0` | 排序 |

索引：`UNIQUE (handle) WHERE deleted_at IS NULL`；`idx_cat_parent (parent_id)`。软删。

### product_category_link
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| product_id | text | 否 | — | FK → product.id |
| category_id | text | 否 | — | FK → product_category.id |

索引：`UNIQUE (product_id, category_id)`。无软删。

---

## 2. M02 Pricing（4 表）

### price_set
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| （无业务列） | — | — | — | 价格容器，与 variant 经 links `variant_price_set` 关联 |

软删。

### price
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| price_set_id | text | 否 | — | FK → price_set.id |
| currency_code | char(3) | 否 | — | 币种 |
| amount_minor | bigint | 否 | — | 金额（最小单位） |
| compare_at_amount_minor | bigint | 是 | — | 划线价 |
| price_list_id | text | 是 | — | FK → price_list.id；NULL = 默认价 |
| min_quantity | int4 | 否 | `1` | 起步数量 |
| max_quantity | int4 | 是 | — | 上限数量 |

索引：`UNIQUE (price_set_id, currency_code, price_list_id, min_quantity) WHERE deleted_at IS NULL`。软删。

### price_list
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 名称 |
| type | text | 否 | `manual` | 枚举：manual / rule |
| starts_at | timestamptz | 是 | — | 生效时间 |
| ends_at | timestamptz | 是 | — | 失效时间 |
| status | text | 否 | `active` | 枚举：active / draft |

软删。

### price_list_rule
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| price_list_id | text | 否 | — | FK → price_list.id |
| rule_type | text | 否 | — | 枚举：currency / channel / product_type / product / variant / customer_group / all |
| rule_value | text | 是 | — | 规则值 |

索引：`idx_plr_list (price_list_id)`。软删。

---

## 3. M03 Region + Channel（4 表）

### region
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 区域名 |
| currency_code | char(3) | 否 | — | 币种 |
| is_active | bool | 否 | `true` | 是否启用 |

软删。

### region_country
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| region_id | text | 否 | — | FK → region.id |
| country_code | char(2) | 否 | — | 国家码 |

索引：`UNIQUE (region_id, country_code)`。无软删。

### channel
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 渠道名 |
| slug | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| currency_code | char(3) | 否 | — | 币种（须与 region 一致，应用层校验） |
| region_id | text | 否 | — | FK → region.id（模块内） |
| default_locale | text | 否 | `zh-CN` | 默认语言 |
| market_scope | text | 否 | `cn` | 地区属性（§12 R10）：cn / intl，用于过滤支付 Provider |
| is_active | bool | 否 | `true` | 是否启用 |
| metadata | jsonb | 是 | — | 扩展 |

索引：`UNIQUE (slug) WHERE deleted_at IS NULL`。软删。

### channel_locale
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| channel_id | text | 否 | — | FK → channel.id |
| locale | text | 否 | — | 如 zh-CN |
| is_default | bool | 否 | `false` | 默认语言 |

索引：`UNIQUE (channel_id, locale)`。无软删。

---

## 4. M04 Cart（4 表）

### cart
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| channel_id | text | 否 | — | 跨模块 id 列（无 FK） |
| region_id | text | 否 | — | 跨模块 id 列 |
| currency_code | char(3) | 否 | — | 币种 |
| customer_id | text | 是 | — | 跨模块 id 列；游客 NULL |
| email | text | 是 | — | 游客留邮箱 |
| status | text | 否 | `open` | 枚举：open / completed / abandoned |
| totals | jsonb | 是 | — | 汇总快照 `{subtotal_minor, shipping_minor, tax_minor, total_minor, discount_minor}` |
| metadata | jsonb | 是 | — | 扩展 |
| expires_at | timestamptz | 是 | — | 过期时间 |

索引：`idx_cart_channel (channel_id)`；`idx_cart_customer (customer_id) WHERE customer_id IS NOT NULL`。软删。

### cart_line_item
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| cart_id | text | 否 | — | FK → cart.id |
| variant_id | text | 否 | — | 跨模块 id 列 |
| product_id | text | 否 | — | 跨模块 id 列（冗余便于展示） |
| title | text | 否 | — | 快照 |
| quantity | int4 | 否 | — | 数量（>0） |
| unit_price_minor | bigint | 否 | — | 快照 |
| currency_code | char(3) | 否 | — | 币种 |
| metadata | jsonb | 是 | — | 扩展 |

索引：`idx_cli_cart (cart_id)`。软删。

### cart_line_item_adjustment
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| cart_line_item_id | text | 否 | — | FK → cart_line_item.id |
| type | text | 否 | — | 枚举：discount / tax / shipping（一期主要 tax） |
| amount_minor | bigint | 否 | — | 金额（正负皆可） |
| description | text | 是 | — | 说明 |

索引：`idx_clia_line (cart_line_item_id)`。软删。

### cart_shipping_method
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| cart_id | text | 否 | — | FK → cart.id |
| shipping_option_id | text | 否 | — | 跨模块 id 列 |
| name | text | 否 | — | 快照 |
| amount_minor | bigint | 否 | — | 运费 |
| currency_code | char(3) | 否 | — | 币种 |

索引：`idx_csm_cart (cart_id)`。软删。

---

## 5. M05 Order（5 表）

### order
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| status | text | 否 | `pending` | 枚举：pending / awaiting_payment / paid / fulfilled / completed / canceled / refunded |
| cart_id | text | 是 | — | 跨模块 id 列 |
| customer_id | text | 是 | — | 跨模块 id 列 |
| email | text | 否 | — | 下单邮箱快照 |
| currency_code | char(3) | 否 | — | 币种 |
| channel_id | text | 否 | — | 跨模块 id 列 |
| region_id | text | 否 | — | 跨模块 id 列 |
| subtotal_minor | bigint | 否 | — | 商品小计 |
| shipping_minor | bigint | 否 | `0` | 运费 |
| tax_minor | bigint | 否 | `0` | 税 |
| discount_minor | bigint | 否 | `0` | 折扣 |
| total_minor | bigint | 否 | — | 总额 |
| payment_status | text | 否 | `unpaid` | 枚举：unpaid / authorized / captured / refunded |
| shipping_address | jsonb | 否 | — | 收货地址快照 |
| billing_address | jsonb | 是 | — | 账单地址快照 |
| payment_collection_id | text | 是 | — | 跨模块 id 列 |
| metadata | jsonb | 是 | — | 扩展 |
| placed_at | timestamptz | 是 | — | 下单时间 |

索引：`idx_order_channel (channel_id)`；`idx_order_customer (customer_id) WHERE customer_id IS NOT NULL`；`idx_order_status (status)`。无软删（取消用 status=canceled）。

### order_line_item
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| order_id | text | 否 | — | FK → order.id |
| variant_id | text | 否 | — | 跨模块 id 列 |
| product_id | text | 否 | — | 跨模块 id 列 |
| title | text | 否 | — | 快照 |
| sku | text | 否 | — | 快照 |
| quantity | int4 | 否 | — | 数量 |
| unit_price_minor | bigint | 否 | — | 含税口径由 channel 决定 |
| tax_rate_bps | int4 | 否 | `0` | 快照（1300 = 13%） |
| tax_amount_minor | bigint | 否 | `0` | 行级税额 |
| total_minor | bigint | 否 | — | 行总额 |
| currency_code | char(3) | 否 | — | 币种 |
| options | jsonb | 是 | — | 属性快照 |

索引：`idx_oli_order (order_id)`。无软删。

### order_item_snapshot
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| order_line_item_id | text | 否 | — | FK → order_line_item.id，UNIQUE |
| snapshot | jsonb | 否 | — | 下单时变体完整快照（title/属性/sku/货币） |

索引：`UNIQUE (order_line_item_id)`。无软删。

### order_shipping_method
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| order_id | text | 否 | — | FK → order.id |
| name | text | 否 | — | 快照 |
| carrier_name | text | 是 | — | 快照 |
| amount_minor | bigint | 否 | — | 运费 |
| currency_code | char(3) | 否 | — | 币种 |

索引：`idx_osm_order (order_id)`。无软删。

### order_status_history
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| order_id | text | 否 | — | FK → order.id |
| from_status | text | 是 | — | 原状态 |
| to_status | text | 否 | — | 新状态 |
| actor | text | 否 | — | 枚举：customer / admin / system / workflow |
| reason | text | 是 | — | 原因 |

索引：`idx_osh_order (order_id, created_at)`。无软删（历史不可变）。

---

## 6. M06 Payment（7 表）

### payment_collection
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| cart_id | text | 是 | — | 跨模块 id 列 |
| order_id | text | 是 | — | 跨模块 id 列 |
| currency_code | char(3) | 否 | — | 币种 |
| amount_minor | bigint | 否 | — | 应付金额 |
| status | text | 否 | `not_paid` | 枚举：not_paid / awaiting / authorized / captured / partially_refunded / refunded |
| metadata | jsonb | 是 | — | 扩展 |

软删。

### payment_session
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| payment_collection_id | text | 否 | — | FK → payment_collection.id |
| provider_id | text | 否 | — | Provider 标识（如 pp_wechat） |
| status | text | 否 | `pending` | 枚举：pending / requires_more / authorized / captured / failed / canceled / expired |
| amount_minor | bigint | 否 | — | 金额 |
| currency_code | char(3) | 否 | — | 币种 |
| provider_reference | text | 是 | — | 网关交易号 |
| provider_raw | jsonb | 是 | — | 网关原始数据 |
| context | jsonb | 是 | — | 客户端拉起所需 `{kind, qrcode/redirectUrl/clientSecret}` |
| expires_at | timestamptz | 是 | — | 会话过期（30 分钟，见 §5.9/Q7） |

索引：`idx_paysess_collection (payment_collection_id)`。软删。

### payment
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| payment_collection_id | text | 否 | — | FK → payment_collection.id |
| session_id | text | 是 | — | FK → payment_session.id |
| amount_minor | bigint | 否 | — | 金额 |
| currency_code | char(3) | 否 | — | 币种 |
| status | text | 否 | `pending` | 枚举：pending / authorized / captured / failed / canceled / refunded |
| provider_id | text | 否 | — | Provider 标识 |
| provider_reference | text | 是 | — | 网关交易号 |
| captured_at | timestamptz | 是 | — | 请款时间 |

索引：`idx_pay_collection (payment_collection_id)`。软删。

### payment_transaction
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| payment_id | text | 否 | — | FK → payment.id |
| type | text | 否 | — | 枚举：authorize / capture / refund / cancel / void |
| amount_minor | bigint | 否 | — | 金额 |
| currency_code | char(3) | 否 | — | 币种 |
| status | text | 否 | `pending` | 枚举：pending / succeeded / failed |
| provider_reference | text | 是 | — | 网关交易号 |
| provider_raw | jsonb | 是 | — | 原始 |
| idempotency_key | text | 否 | — | 网关幂等键（§5.6） |

索引：`idx_paytxn_payment (payment_id)`；`UNIQUE (idempotency_key)`。软删。

### refund
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| payment_id | text | 否 | — | FK → payment.id |
| order_id | text | 是 | — | 跨模块 id 列 |
| amount_minor | bigint | 否 | — | 退款金额 |
| currency_code | char(3) | 否 | — | 币种 |
| reason | text | 是 | — | 原因 |
| status | text | 否 | `pending` | 枚举：pending / succeeded / failed |
| provider_reference | text | 是 | — | 网关退款号 |
| idempotency_key | text | 否 | — | 网关幂等键 |

索引：`idx_rfd_payment (payment_id)`；`UNIQUE (idempotency_key)`。软删。

### payment_provider_config
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| identifier | text | 否 | — | 唯一（pp_wechat / pp_alipay / pp_stripe / pp_paypal / pp_fake） |
| label | text | 否 | — | 显示名 |
| capabilities | jsonb | 是 | — | `{webhook, partialRefund, authorizeThenCapture, qrFlow, redirectFlow}` |
| options_encrypted | text | 是 | — | AES-256-GCM 加密的密钥配置（§6.1） |
| is_enabled | bool | 否 | `false` | 全局启用（channel 级启用走 links） |

索引：`UNIQUE (identifier) WHERE deleted_at IS NULL`。软删。

### provider_webhook_event
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| provider_id | text | 否 | — | Provider 标识 |
| event_id | text | 否 | — | 网关事件唯一 ID（去重） |
| payload | jsonb | 否 | — | 验签/解密后归一化 payload |
| raw | jsonb | 是 | — | 原始（仅调试，可关） |
| processed | bool | 否 | `false` | 是否已处理 |
| processed_at | timestamptz | 是 | — | 处理时间 |
| error | jsonb | 是 | — | 处理失败信息 |

索引：`UNIQUE (provider_id, event_id)`。无软删（审计，TTL 清理）。

---

## 7. M07 Inventory（4 表）

### inventory_item
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| sku | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| title | text | 是 | — | 名称 |
| requires_shipping | bool | 否 | `true` | 是否需发货 |

索引：`UNIQUE (sku) WHERE deleted_at IS NULL`。软删。

### stock_location
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 仓库名 |
| address | jsonb | 是 | — | 地址 |
| priority | int4 | 否 | `0` | 分配优先级（一期唯一分配策略） |

软删。

### inventory_level
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| inventory_item_id | text | 否 | — | FK → inventory_item.id |
| stock_location_id | text | 否 | — | FK → stock_location.id |
| stocked_quantity | int4 | 否 | `0` | 在库量 |
| reserved_quantity | int4 | 否 | `0` | 预留量（冗余，真实值由 reservation_item 汇总） |
| available_quantity | int4 | 否 | `0` | 可用量 = stocked - reserved（应用层维护） |

索引：`UNIQUE (inventory_item_id, stock_location_id) WHERE deleted_at IS NULL`。软删。

### reservation_item
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| inventory_item_id | text | 否 | — | FK → inventory_item.id |
| stock_location_id | text | 否 | — | FK → stock_location.id |
| line_item_id | text | 否 | — | 跨模块：cart_line_item 或 order_line_item id |
| order_id | text | 是 | — | 跨模块 id 列 |
| quantity | int4 | 否 | — | 预留数量 |
| status | text | 否 | `reserved` | 枚举：reserved / committed / released |
| workflow_run_id | text | 是 | — | 关联 workflow 执行（追溯） |
| expires_at | timestamptz | 是 | — | 支付超时释放时间 |

索引：`idx_rsv_item (inventory_item_id, stock_location_id)`；`idx_rsv_status (status)`；`idx_rsv_expires (expires_at) WHERE status='reserved'`。无软删（状态覆盖）。

---

## 8. M08 Fulfillment（6 表）

### shipping_zone
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 名称 |
| country_codes | jsonb | 否 | — | zone 覆盖国家 |

软删。

### shipping_option
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 名称 |
| zone_id | text | 否 | — | FK → shipping_zone.id |
| carrier | text | 是 | — | 承运商（一期手工） |
| type | text | 否 | `flat` | 枚举：flat / weight_based / free_over |
| amount_minor | bigint | 否 | — | 金额（flat） |
| currency_code | char(3) | 否 | — | 币种 |
| is_active | bool | 否 | `true` | 启用 |

索引：`idx_shipopt_zone (zone_id)`。软删。

### shipping_option_price_rule
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| shipping_option_id | text | 否 | — | FK → shipping_option.id |
| rule_type | text | 否 | — | 枚举：weight_based / free_over |
| weight_min_g | int4 | 是 | — | 重量下限 |
| weight_max_g | int4 | 是 | — | 重量上限 |
| order_over_minor | bigint | 是 | — | 满额包邮门槛 |
| amount_minor | bigint | 否 | — | 金额 |

索引：`idx_shiprule_option (shipping_option_id)`。软删。

### fulfillment
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| order_id | text | 否 | — | 跨模块 id 列 |
| status | text | 否 | `not_fulfilled` | 枚举：not_fulfilled / fulfilled / shipped / delivered / canceled |
| tracking_links | jsonb | 是 | — | 手工承运商 + 单号列表 |
| metadata | jsonb | 是 | — | 扩展 |

索引：`idx_fulf_order (order_id)`。软删。

### fulfillment_item
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| fulfillment_id | text | 否 | — | FK → fulfillment.id |
| order_line_item_id | text | 否 | — | 跨模块 id 列 |
| quantity | int4 | 否 | — | 数量 |

索引：`idx_fulfitem_fulfillment (fulfillment_id)`。无软删。

### shipment
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| fulfillment_id | text | 否 | — | FK → fulfillment.id |
| carrier_name | text | 否 | — | 手工填承运商 |
| tracking_number | text | 否 | — | 手工填单号 |
| shipped_at | timestamptz | 否 | `now()` | 发货时间 |

索引：`idx_ship_fulfillment (fulfillment_id)`。无软删。

---

## 9. M09 Tax（2 表）

### tax_rate
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 名称 |
| rate_bps | int4 | 否 | — | 税率（1300 = 13%） |
| is_inclusive | bool | 否 | `true` | 含税 |

软删。

### tax_rate_rule
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| tax_rate_id | text | 否 | — | FK → tax_rate.id |
| rule_type | text | 否 | — | 枚举：channel（一期） |
| rule_value | text | 否 | — | channel_id |

索引：`idx_taxr_rate (tax_rate_id)`。软删。

---

## 10. M10 Customer（3 表）

### customer
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| email | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| first_name | text | 是 | — | 名 |
| last_name | text | 是 | — | 姓 |
| phone | text | 是 | — | 仅软标识（不校验，坑清单/§6.0） |
| metadata | jsonb | 是 | — | 扩展 |

索引：`UNIQUE (email) WHERE deleted_at IS NULL`。软删。

### customer_address
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| customer_id | text | 否 | — | FK → customer.id |
| first_name | text | 否 | — | 收件名 |
| last_name | text | 否 | — | 收件姓 |
| phone | text | 是 | — | 电话 |
| line1 | text | 否 | — | 地址行 1 |
| line2 | text | 是 | — | 地址行 2 |
| city | text | 否 | — | 城市 |
| province | text | 是 | — | 省 |
| postal_code | text | 否 | — | 邮编 |
| country_code | char(2) | 否 | — | 国家 |
| is_default_shipping | bool | 否 | `false` | 默认收货 |
| is_default_billing | bool | 否 | `false` | 默认账单 |

索引：`idx_addr_customer (customer_id)`。软删。

### customer_group
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 组名（一期建表不用，二期 B2B） |

软删。

---

## 11. M11 Auth（7 表）

### auth_identity
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| email | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| scope | text | 否 | `customer` | 枚举：customer / admin |
| customer_id | text | 是 | — | 跨模块 id 列（customer scope） |
| admin_user_id | text | 是 | — | FK → admin_user.id（admin scope） |
| status | text | 否 | `active` | 枚举：active / disabled |

索引：`UNIQUE (email) WHERE deleted_at IS NULL`。软删。

### auth_credential
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| auth_identity_id | text | 否 | — | FK → auth_identity.id，UNIQUE |
| password_hash | text | 否 | — | argon2id |

索引：`UNIQUE (auth_identity_id)`。无软删。

### provider_identity
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| auth_identity_id | text | 否 | — | FK → auth_identity.id |
| provider | text | 否 | — | emailpass / wechat_oauth（二期） |
| provider_subject | text | 否 | — | provider 侧唯一标识 |

索引：`UNIQUE (provider, provider_subject)`。无软删。

### refresh_token
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| auth_identity_id | text | 否 | — | FK → auth_identity.id |
| token_hash | text | 否 | — | 哈希（不存明文），UNIQUE |
| scope | text | 否 | — | 枚举：customer / admin |
| expires_at | timestamptz | 否 | — | 过期（customer 30d / admin 7d） |
| revoked_at | timestamptz | 是 | — | 撤销时间 |
| replaced_by | text | 是 | — | 轮换后指向新 token id |

索引：`UNIQUE (token_hash)`；`idx_rt_identity (auth_identity_id)`。无软删。

### admin_user
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| email | text | 否 | — | 唯一（`WHERE deleted_at IS NULL`） |
| name | text | 是 | — | 名称 |
| status | text | 否 | `active` | 枚举：active / disabled |

索引：`UNIQUE (email) WHERE deleted_at IS NULL`。软删。

### rbac_role
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| name | text | 否 | — | 唯一：admin / staff |
| permissions | jsonb | 否 | — | 权限列表，`"all"` 表示全部 |

索引：`UNIQUE (name) WHERE deleted_at IS NULL`。软删。

### rbac_user_role
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| admin_user_id | text | 否 | — | FK → admin_user.id |
| rbac_role_id | text | 否 | — | FK → rbac_role.id |

索引：`UNIQUE (admin_user_id, rbac_role_id)`。无软删。

---

## 12. M12 Event Bus（3 表）

### event_outbox
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| event_name | text | 否 | — | 事件名（order.placed 等） |
| payload | jsonb | 否 | — | 事件载荷 |
| aggregate_type | text | 是 | — | 聚合类型 |
| aggregate_id | text | 是 | — | 聚合 id |
| published_at | timestamptz | 是 | — | 投递到队列时间（NULL=未投递） |

索引：`idx_evt_published (published_at) WHERE published_at IS NULL`。无软删（投递后 TTL 清理）。

### subscriber_checkpoint
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| subscriber_name | text | 否 | — | 唯一 |
| last_event_id | text | 是 | — | 最后处理的事件 id |
| updated_at | timestamptz | 否 | `now()` | 更新时间 |

索引：`UNIQUE (subscriber_name)`。无软删。

### job_dead_letter
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| kind | text | 否 | — | 枚举：workflow / queue_job / compensation |
| ref_id | text | 否 | — | executionId / jobId |
| step_id | text | 是 | — | 步骤 id |
| payload | jsonb | 否 | — | 载荷 |
| error | jsonb | 否 | — | 错误 |
| attempts | int4 | 否 | `0` | 尝试次数 |
| resolved_at | timestamptz | 是 | — | 人工处理时间 |
| resolved_by | text | 是 | — | 处理人 |

索引：`idx_dlq_kind (kind, resolved_at) WHERE resolved_at IS NULL`。无软删。

---

## 13. M13 File（2 表）

### file
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| key | text | 否 | — | 存储 key（随机文件名，防路径穿越），UNIQUE |
| filename | text | 否 | — | 原始名（仅展示） |
| content_type | text | 否 | — | MIME（魔数双校验） |
| size_bytes | bigint | 否 | — | 大小 |
| width_px | int4 | 是 | — | 宽 |
| height_px | int4 | 是 | — | 高 |
| storage_provider | text | 否 | `local` | 枚举：local / s3 |
| metadata | jsonb | 是 | — | 扩展 |

索引：`UNIQUE (key) WHERE deleted_at IS NULL`。软删。

### file_variant
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| file_id | text | 否 | — | FK → file.id |
| variant | text | 否 | — | 枚举：original / webp / thumb |
| key | text | 否 | — | 派生文件 key，UNIQUE |
| width_px | int4 | 是 | — | 宽 |
| height_px | int4 | 是 | — | 高 |
| size_bytes | bigint | 否 | — | 大小 |

索引：`UNIQUE (file_id, variant)`；`UNIQUE (key) WHERE deleted_at IS NULL`。软删。

---

## 14. M17 Theme（2 表）

### theme_settings
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| primary_color | text | 否 | design-tokens primary | 主色（设计变量，默认值由 design-tokens.json 提供，禁硬编码） |
| font_family | text | 否 | `Inter, Noto Sans SC` | 字体 |
| border_radius | text | 否 | `8px` | 圆角 |
| shadow | text | 否 | `none` | 阴影 |
| logo_file_id | text | 是 | — | 跨模块 id 列（指向 file） |
| product_image_ratio | text | 否 | `1:1` | 商品图比例 |
| metadata | jsonb | 是 | — | 扩展 |

无软删（单例表，仅一行，应用层保证）。

### theme_revision
| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| version | int4 | 否 | — | 版本号 |
| settings | jsonb | 否 | — | 发布时完整快照 |
| published_at | timestamptz | 否 | `now()` | 发布时间 |

索引：`UNIQUE (version)`。无软删（历史）。

---

## 15. links 关联表（13 张，铁律 2 / 架构 §4.3 规则 4 条）

> 通用列：`id text PK (lnk_...)`、`created_at`、`updated_at`、`deleted_at`（软删）。**无 REFERENCES、无业务字段**，只有两个 id 列 + 关系属性列 + 时间戳。唯一索引带 `WHERE deleted_at IS NULL`。删除语义三态：restrict（默认）/ dismiss / cascade。

| 表 | 左 id 列 | 右 id 列 | 基数 | 唯一约束（部分索引） | 普通索引 | 关系属性列 | 删除语义 |
|---|---|---|---|---|---|---|---|
| product_channel | product_id | channel_id | N:N | (product_id, channel_id) | (channel_id, product_id) | is_visible bool default true；sort_order int4 | restrict |
| variant_price_set | variant_id | price_set_id | N:1 | (variant_id) 唯一 | (price_set_id) | — | dismiss |
| price_list_channel | price_list_id | channel_id | N:N | (price_list_id, channel_id) | (channel_id) | — | restrict |
| inventory_item_variant | inventory_item_id | variant_id | 1:1 | (variant_id) 唯一 + (inventory_item_id) 唯一 | — | — | dismiss |
| stock_location_channel | stock_location_id | channel_id | N:N | (stock_location_id, channel_id) | (channel_id) | — | restrict |
| shipping_option_channel | shipping_option_id | channel_id | N:N | (shipping_option_id, channel_id) | (channel_id) | — | restrict |
| payment_provider_channel | payment_provider_config_id | channel_id | N:N | (payment_provider_config_id, channel_id) | (channel_id) | is_enabled bool default false；sort_order int4 | restrict |
| tax_rate_channel | tax_rate_id | channel_id | N:1 | (channel_id) 唯一（一期一渠道一税率） | (tax_rate_id) | — | restrict |
| order_payment_collection | order_id | payment_collection_id | 1:1 | (order_id) 唯一 | (payment_collection_id) | — | cascade |
| order_fulfillment | order_id | fulfillment_id | 1:N | (fulfillment_id) 唯一 | (order_id) | — | cascade |
| cart_customer | cart_id | customer_id | N:1 | (cart_id) 唯一 | (customer_id) | — | dismiss |
| order_customer | order_id | customer_id | N:1 | (order_id) 唯一 | (customer_id) | — | restrict |
| product_image_file | product_image_id | file_id | N:1 | (product_image_id) 唯一 | (file_id) | — | dismiss |

> cascade 仅限 1:1 且生命周期完全从属（order_payment_collection / order_fulfillment），已在架构 §4.3 登记理由。

---

## 16. 内核表（非 Spec §6 清单，属 packages/core，架构 §5.4 已定义）

> 以下 3 张表不属于 14 模块的 63 张表，也不属于 links，是自研 Workflow 引擎与幂等机制的内核表。字段级定义见架构 §5.4（`workflow_execution` / `workflow_step_execution` / `idempotency_keys`），Phase 3 以架构 §5.4 的 SQL 为准，此处仅登记表名避免遗漏。

| 内核表 | 归属 | 用途 |
|---|---|---|
| workflow_execution | packages/core/workflow | 一次 workflow 执行（状态/幂等键/输入输出/心跳） |
| workflow_step_execution | packages/core/workflow | 步骤日志（幂等 + 重放 + 补偿栈） |
| idempotency_keys | packages/core/http | API 层幂等键（回放响应） |
