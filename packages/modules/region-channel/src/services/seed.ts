import { prefixedUlid } from "@mall/core";
import type { ChannelRepository, RegionRepository } from "../types.js";

/** 种子：1 Region(CN/CNY) + 1 Channel(slug=cn, CNY, zh-CN)。按自然键幂等，可重复执行。 */
export async function seedDefaults(deps: {
  regionRepo: RegionRepository;
  channelRepo: ChannelRepository;
}): Promise<void> {
  const existingRegion = await deps.regionRepo.findByCurrency("CNY");
  const regionId =
    existingRegion?.id ??
    (await deps.regionRepo.create({ id: prefixedUlid("reg"), name: "中国大陆", currencyCode: "CNY" })).id;

  const existingChannel = await deps.channelRepo.findBySlug("cn");
  if (!existingChannel) {
    await deps.channelRepo.create({
      id: prefixedUlid("chn"),
      name: "中国大陆渠道",
      slug: "cn",
      currencyCode: "CNY",
      regionId,
      defaultLocale: "zh-CN",
      marketScope: "cn",
    });
  }
}
