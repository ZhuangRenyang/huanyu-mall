import { DomainError } from "@mall/core";

export function optionNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Shipping option not found: ${id}` });
}

export function fulfillmentNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Fulfillment not found: ${id}` });
}
