import { DomainError } from "@mall/core";

export function themeNotFound(): DomainError {
  return new DomainError({ code: 30001, message: "Theme settings not found" });
}
