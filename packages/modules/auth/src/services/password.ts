import { hash, verify } from "@node-rs/argon2";
import type { PasswordHasher } from "../types.js";

/** argon2id（OWASP 基线：memoryCost=19456, timeCost=2, parallelism=1）。 */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(
    private readonly options = { memoryCost: 19456, timeCost: 2, parallelism: 1 },
  ) {}

  async hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      return false;
    }
  }
}
