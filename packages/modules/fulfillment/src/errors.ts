import { DomainError } from "@mall/core";

export function optionNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Shipping option not found: ${id}` });
}

export function fulfillmentNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Fulfillment not found: ${id}` });
}

/** 订单没有可发货的预留（未预留/已全部出库/已释放）。 */
export function noReservations(orderId: string): DomainError {
  return new DomainError({ code: 30002, message: `订单 ${orderId} 没有可发货的预留` });
}

/** 指定仓在该订单没有预留。 */
export function noReservationAtLocation(orderId: string, locationId: string): DomainError {
  return new DomainError({
    code: 30002,
    message: `订单 ${orderId} 在仓 ${locationId} 没有预留`,
  });
}

/**
 * 订单预留跨多仓时必须指定发货仓（ADR-013 §3：不自动猜分组，猜错会「发货了但库存没扣」）。
 * 错误详情带可选仓 id 列表，后台据此让操作员选仓。
 */
export function stockLocationRequired(orderId: string, locations: string[]): DomainError {
  return new DomainError({
    code: 30002,
    message: `订单 ${orderId} 的预留跨 ${locations.length} 个仓，必须指定 stock_location_id`,
    details: locations,
  });
}

/** 传入的预留 id 不属于所选仓（跨仓发货单禁止）。 */
export function reservationNotInLocation(orderId: string, reservationId: string): DomainError {
  return new DomainError({
    code: 30002,
    message: `预留 ${reservationId} 不属于订单 ${orderId} 所选仓`,
  });
}

/** 发货数量必须等于该仓预留数量（一期不支持部分发货）。 */
export function fulfillmentQuantityMismatch(expected: number, actual: number): DomainError {
  return new DomainError({
    code: 30002,
    message: `发货数量与该仓预留不一致：预留 ${expected}，本次发货 ${actual}`,
  });
}

// ---------------------------------------------------------------- *
// 运费配置（后台「设置 → 运费」）
// ---------------------------------------------------------------- *

export function zoneNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Shipping zone not found: ${id}` });
}

/**
 * 同一国家只能属于一个发货区。
 *
 * 这不是「多一层校验」，而是**唯一性的根**：两个区同时覆盖一个国家时，
 * 结账会拿到两套价格，选最便宜的那条就成了可绕过口子。
 */
export function countryAlreadyInZone(countryCode: string, zoneName: string): DomainError {
  return new DomainError({
    code: 30002,
    message: `国家 ${countryCode} 已在发货区「${zoneName}」中，请先从该区移除`,
  });
}

/** 区内还有运费方式，禁止删除（否则该区国家结账直接算不出运费）。 */
export function zoneHasOptions(zoneName: string, count: number): DomainError {
  return new DomainError({
    code: 30002,
    message: `发货区「${zoneName}」下还有 ${count} 个运费方式，请先删除或改到别的区`,
  });
}

export function invalidShippingCountry(code: string): DomainError {
  return new DomainError({
    code: 20001,
    message: `国家码必须是两位字母（ISO 3166-1 alpha-2）：${code}`,
  });
}

export function invalidShippingAmount(message: string): DomainError {
  return new DomainError({ code: 20001, message });
}

/** 满额包邮必须有门槛：门槛为 0 等于全场包邮，该用「固定价 0」表达，不能混。 */
export function freeOverThresholdRequired(): DomainError {
  return new DomainError({
    code: 20001,
    message: "满额包邮必须填写门槛金额（大于 0）；要全场包邮请把固定价设为 0",
  });
}

// ---------------------------------------------------------------- *
// 运费模板
// ---------------------------------------------------------------- *

export function profileNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `运费模板不存在：${id}` });
}

/** 默认模板是全店的兜底：商品没指定模板时用它，删了会让一堆商品算不出运费。 */
export function defaultProfileUndeletable(): DomainError {
  return new DomainError({ code: 30002, message: "默认运费模板不能删除" });
}

export function profileHasZones(name: string, count: number): DomainError {
  return new DomainError({
    code: 30002,
    message: `运费模板「${name}」下还有 ${count} 个发货区，请先删除或改到别的模板`,
  });
}
