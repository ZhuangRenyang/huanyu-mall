import { DomainError } from "@mall/core";

/** M07 模块错误（code 对齐架构 §7.4）。 */
export function insufficientStock(variantId: string, requested: number, available: number): DomainError {
  return new DomainError({
    code: 30003,
    message: `库存不足：${variantId} 需要 ${requested} 仅有 ${available}`,
  });
}

export function inventoryItemNotFound(variantId: string): DomainError {
  return new DomainError({ code: 30001, message: `Inventory item not found for variant: ${variantId}` });
}

export function levelNotFound(itemId: string, locationId: string): DomainError {
  return new DomainError({ code: 30001, message: `Inventory level not found: ${itemId}@${locationId}` });
}

export function reservationNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Reservation not found: ${id}` });
}

export function reservationStateInvalid(id: string, status: string): DomainError {
  return new DomainError({ code: 30002, message: `Reservation ${id} is ${status}, cannot transition` });
}

/** 数量必须是正整数（库存计数禁浮点/零/负）。 */
export function invalidQuantity(variantId: string, quantity: number): DomainError {
  return new DomainError({
    code: 30002,
    message: `库存数量非法：${variantId} 的 quantity=${quantity}（必须为正整数）`,
  });
}

export function inventoryItemNotFoundById(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Inventory item not found: ${id}` });
}

export function stockLocationNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Stock location not found: ${id}` });
}

// —— 仓间调拨（ADR-013 §4）——

export function transferNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Inventory transfer not found: ${id}` });
}

export function transferStateInvalid(id: string, status: string): DomainError {
  return new DomainError({ code: 30002, message: `Inventory transfer ${id} is ${status}, cannot transition` });
}

export function transferLocationsSame(fromLocationId: string, toLocationId: string): DomainError {
  return new DomainError({
    code: 30002,
    message: `调拨源仓与目标仓不能相同：${fromLocationId} → ${toLocationId}`,
  });
}

/** 源仓可用量不足（不能把已承诺给订单的货调走）。 */
export function transferInsufficientStock(
  itemId: string,
  fromLocationId: string,
  quantity: number,
): DomainError {
  return new DomainError({
    code: 30003,
    message: `调拨失败：${itemId}@${fromLocationId} 可用量不足以调出 ${quantity}`,
  });
}
