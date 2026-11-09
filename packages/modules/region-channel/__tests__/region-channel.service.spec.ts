import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { RegionChannelService } from "../src/services/region-channel.service.js";
import { seedDefaults } from "../src/services/seed.js";
import type {
  ChannelDTO,
  ChannelRepository,
  CreateChannelInput,
  CreateRegionInput,
  RegionDTO,
  RegionRepository,
} from "../src/types.js";

class InMemoryRegionRepository implements RegionRepository {
  readonly regions = new Map<string, RegionDTO>();

  async findById(id: string): Promise<RegionDTO | null> {
    return this.regions.get(id) ?? null;
  }
  async findByCurrency(currencyCode: string): Promise<RegionDTO | null> {
    return [...this.regions.values()].find((r) => r.currency_code === currencyCode) ?? null;
  }
  async list(): Promise<RegionDTO[]> {
    return [...this.regions.values()];
  }
  async create(input: CreateRegionInput): Promise<RegionDTO> {
    const dto: RegionDTO = {
      id: input.id,
      name: input.name,
      currency_code: input.currencyCode,
      is_active: input.isActive ?? true,
    };
    this.regions.set(dto.id, dto);
    return dto;
  }
}

class InMemoryChannelRepository implements ChannelRepository {
  readonly channels = new Map<string, ChannelDTO>();

  async findById(id: string): Promise<ChannelDTO | null> {
    return this.channels.get(id) ?? null;
  }
  async findBySlug(slug: string): Promise<ChannelDTO | null> {
    return [...this.channels.values()].find((c) => c.slug === slug) ?? null;
  }
  async list(q?: { isActive?: boolean }): Promise<ChannelDTO[]> {
    const all = [...this.channels.values()];
    return q?.isActive === undefined ? all : all.filter((c) => c.is_active === q.isActive);
  }
  async create(input: CreateChannelInput): Promise<ChannelDTO> {
    const dto: ChannelDTO = {
      id: input.id,
      name: input.name,
      slug: input.slug,
      currency_code: input.currencyCode,
      region_id: input.regionId,
      default_locale: input.defaultLocale ?? "zh-CN",
      market_scope: input.marketScope ?? "cn",
      is_active: input.isActive ?? true,
      metadata: input.metadata ?? null,
    };
    this.channels.set(dto.id, dto);
    return dto;
  }
}

function makeService() {
  const regionRepo = new InMemoryRegionRepository();
  const channelRepo = new InMemoryChannelRepository();
  const service = new RegionChannelService({ regionRepo, channelRepo });
  return { service, regionRepo, channelRepo };
}

describe("RegionChannelService（M03 契约）", () => {
  it("getRegion 命中 / 未命中抛 DomainError(30001)", async () => {
    const { service, regionRepo } = makeService();
    const r = await regionRepo.create({ id: "reg_1", name: "中国大陆", currencyCode: "CNY" });

    await expect(service.getRegion("reg_1")).resolves.toEqual(r);
    await expect(service.getRegion("reg_missing")).rejects.toThrow(DomainError);
  });

  it("listRegions / listChannels 过滤", async () => {
    const { service, regionRepo, channelRepo } = makeService();
    await regionRepo.create({ id: "reg_1", name: "中国大陆", currencyCode: "CNY" });
    await channelRepo.create({ id: "chn_1", name: "cn", slug: "cn", currencyCode: "CNY", regionId: "reg_1", isActive: true });
    await channelRepo.create({ id: "chn_2", name: "intl", slug: "intl", currencyCode: "USD", regionId: "reg_1", isActive: false });

    expect(await service.listRegions()).toHaveLength(1);
    expect(await service.listChannels()).toHaveLength(2);
    expect(await service.listChannels({ isActive: true })).toHaveLength(1);
  });

  it("getChannelBySlug 命中 / 未命中", async () => {
    const { service, regionRepo, channelRepo } = makeService();
    await regionRepo.create({ id: "reg_1", name: "中国大陆", currencyCode: "CNY" });
    await channelRepo.create({ id: "chn_1", name: "cn", slug: "cn", currencyCode: "CNY", regionId: "reg_1" });

    await expect(service.getChannelBySlug("cn")).resolves.toMatchObject({ slug: "cn" });
    await expect(service.getChannelBySlug("us")).rejects.toThrow(DomainError);
  });

  it("assertCurrencyAllowed 通过 / 拒绝", async () => {
    const { service, regionRepo, channelRepo } = makeService();
    await regionRepo.create({ id: "reg_1", name: "中国大陆", currencyCode: "CNY" });
    await channelRepo.create({ id: "chn_1", name: "cn", slug: "cn", currencyCode: "CNY", regionId: "reg_1" });

    await expect(service.assertCurrencyAllowed("chn_1", "CNY")).resolves.toBeUndefined();
    await expect(service.assertCurrencyAllowed("chn_1", "USD")).rejects.toThrow(DomainError);
  });

  it("seedDefaults 幂等：跑两遍仍 1 region + 1 channel", async () => {
    const { regionRepo, channelRepo } = makeService();

    await seedDefaults({ regionRepo, channelRepo });
    await seedDefaults({ regionRepo, channelRepo });

    expect(regionRepo.regions.size).toBe(1);
    expect(channelRepo.channels.size).toBe(1);

    const region = await regionRepo.findByCurrency("CNY");
    const channel = await channelRepo.findBySlug("cn");
    expect(region?.currency_code).toBe("CNY");
    expect(channel?.currency_code).toBe("CNY");
    expect(channel?.default_locale).toBe("zh-CN");
  });
});
