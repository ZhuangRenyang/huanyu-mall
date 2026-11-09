import { DomainError } from "@mall/core";

export function customerNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Customer not found: ${id}` });
}

export function addressNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Address not found: ${id}` });
}

export function addressNotOwned(addressId: string): DomainError {
  return new DomainError({ code: 30002, message: `Address ${addressId} does not belong to this customer` });
}
