import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // 一期 mock 图源；真实商品图接入后按 CDN 域名补充。
    remotePatterns: [{ protocol: 'https', hostname: 'picsum.photos' }],
  },
  // 工作区源码包直接编译，不预构建 dist。
  transpilePackages: ['@mall/ui', '@mall/design-tokens', '@mall/sdk'],
  // Docker 部署用 standalone 输出（deploy/docker/Dockerfile.storefront）
  output: 'standalone',
};

export default nextConfig;
