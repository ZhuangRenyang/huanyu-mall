import type { Db } from "./drizzle.js";

/** 事务包装（架构 §8.3）：单库事务，供 repository / service 使用。 */
export async function tx<T>(db: Db, fn: (txDb: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (txDb) => fn(txDb as unknown as Db));
}
