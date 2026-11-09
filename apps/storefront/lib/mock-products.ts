// 兼容导出：目录类型统一收口到 lib/catalog.ts（单一数据源）。
// 仅类型导出：mock 数据请用 '@/lib/catalog' 的 loadMockCatalog() 动态加载，
// 避免静态值导入把假数据打进首屏 bundle。
export type {
  StoreProduct,
  CatalogProduct,
  CatalogVariant,
  CatalogImage,
  MockCategory,
  AttributeGroup,
} from './catalog';
