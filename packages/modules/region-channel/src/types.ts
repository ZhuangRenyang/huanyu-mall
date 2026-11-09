/** M03 Region + Channel DTO 与 repository/service 契约（对齐架构 §2.1）。 */

export interface RegionDTO {
  id: string;
  name: string;
  currency_code: string;
  is_active: boolean;
}

export interface ChannelDTO {
  id: string;
  name: string;
  slug: string;
  currency_code: string;
  region_id: string;
  default_locale: string;
  market_scope: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
}

export interface CreateRegionInput {
  id: string;
  name: string;
  currencyCode: string;
  isActive?: boolean;
}

export interface CreateChannelInput {
  id: string;
  name: string;
  slug: string;
  currencyCode: string;
  regionId: string;
  defaultLocale?: string;
  marketScope?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface RegionRepository {
  findById(id: string): Promise<RegionDTO | null>;
  findByCurrency(currencyCode: string): Promise<RegionDTO | null>;
  list(): Promise<RegionDTO[]>;
  create(input: CreateRegionInput): Promise<RegionDTO>;
}

export interface ChannelRepository {
  findById(id: string): Promise<ChannelDTO | null>;
  findBySlug(slug: string): Promise<ChannelDTO | null>;
  list(q?: { isActive?: boolean }): Promise<ChannelDTO[]>;
  create(input: CreateChannelInput): Promise<ChannelDTO>;
}

/** 跨模块可调用的公开 service 契约（架构 §2.1 M03）。 */
export interface IRegionChannelModuleService {
  getRegion(id: string): Promise<RegionDTO>;
  listRegions(): Promise<RegionDTO[]>;
  getChannel(id: string): Promise<ChannelDTO>;
  getChannelBySlug(slug: string): Promise<ChannelDTO>;
  listChannels(q?: { isActive?: boolean }): Promise<ChannelDTO[]>;
  assertCurrencyAllowed(channelId: string, currencyCode: string): Promise<void>;
}
