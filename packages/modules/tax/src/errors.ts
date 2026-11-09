import { DomainError } from "@mall/core";

export function taxRateNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `Tax rate not found: ${id}` });
}
