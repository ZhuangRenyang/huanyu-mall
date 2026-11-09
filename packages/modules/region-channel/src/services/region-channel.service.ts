import { normalizeCurrencyCode } from "@mall/core";
import { channelNotFound, currencyNotAllowed, regionNotFound } from "../errors.js";
import type {
  ChannelDTO,
  ChannelRepository,
  IRegionChannelModuleService,
  RegionDTO,
  RegionRepository,
} from "../types.js";

/** M03 对外门面（架构 §2.1 契约，仅列出的方法是公开的）。 */
export class RegionChannelService implements IRegionChannelModuleService {
  constructor(
    private readonly deps: {
      regionRepo: RegionRepository;
      channelRepo: ChannelRepository;
    },
  ) {}

  async getRegion(id: string): Promise<RegionDTO> {
    const region = await this.deps.regionRepo.findById(id);
    if (!region) throw regionNotFound();
    return region;
  }

  async listRegions(): Promise<RegionDTO[]> {
    return this.deps.regionRepo.list();
  }

  async getChannel(id: string): Promise<ChannelDTO> {
    const channel = await this.deps.channelRepo.findById(id);
    if (!channel) throw channelNotFound();
    return channel;
  }

  async getChannelBySlug(slug: string): Promise<ChannelDTO> {
    const channel = await this.deps.channelRepo.findBySlug(slug);
    if (!channel) throw channelNotFound();
    return channel;
  }

  async listChannels(q?: { isActive?: boolean }): Promise<ChannelDTO[]> {
    return this.deps.channelRepo.list(q);
  }

  async assertCurrencyAllowed(channelId: string, currencyCode: string): Promise<void> {
    const channel = await this.deps.channelRepo.findById(channelId);
    if (!channel) throw channelNotFound();
    const normalized = normalizeCurrencyCode(currencyCode);
    if (channel.currency_code !== normalized) {
      throw currencyNotAllowed(channelId, normalized);
    }
  }
}
