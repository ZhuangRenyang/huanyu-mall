import { DomainError } from "@mall/core";

/** M13 模块错误（code 对齐架构 §7.4）。 */
export function invalidFileType(detail: string): DomainError {
  return new DomainError({ code: 20001, message: `Invalid file type: ${detail}` });
}

export function contentTypeMismatch(declared: string, actual: string): DomainError {
  return new DomainError({
    code: 20001,
    message: `Content-type mismatch: declared ${declared} but magic bytes are ${actual}`,
  });
}

export function fileTooLarge(max: number): DomainError {
  return new DomainError({ code: 20001, message: `File too large (max ${max} bytes)` });
}

export function emptyFile(): DomainError {
  return new DomainError({ code: 20001, message: "Empty file" });
}

export function fileNotFound(id: string): DomainError {
  return new DomainError({ code: 30001, message: `File not found: ${id}` });
}
