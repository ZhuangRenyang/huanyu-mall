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
