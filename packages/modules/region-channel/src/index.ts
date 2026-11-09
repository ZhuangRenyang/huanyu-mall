import { createDbFor, Module } from "@mall/core";
import type { Pool } from "pg";
import { linkable } from "./linkable.js";
import * as schema from "./models/index.js";
import { DrizzleChannelRepository } from "./repositories/channel.repository.js";
import { DrizzleRegionRepository } from "./repositories/region.repository.js";
import { RegionChannelService } from "./services/region-channel.service.js";

export * from "./types.js";
export * from "./errors.js";
export { linkable } from "./linkable.js";
export { RegionChannelService } from "./services/region-channel.service.js";
import { seedDefaults } from "./services/seed.js";
export { seedDefaults };

/** 自装配种子：install.sh / seed.ts 用（组合根只传 pool，模块自建 repo）。 */
export async function seed(pool: Pool): Promise<void> {
  const db = createDbFor(pool, schema);
  await seedDefaults({
    regionRepo: new DrizzleRegionRepository(db),
    channelRepo: new DrizzleChannelRepository(db),
  });
}

export default Module("region-channel", {
  service: (ctx) => {
    const db = createDbFor(ctx.resolve<Pool>("pool"), schema);
    return new RegionChannelService({
      regionRepo: new DrizzleRegionRepository(db),
      channelRepo: new DrizzleChannelRepository(db),
    });
  },
  migrations: ["migrations/0001_init.sql"],
  linkable,
});
