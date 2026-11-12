/**
 * 业务模块的测试替身入口：把目录侧、交易侧、支付侧替身合成一份 services。
 */
import { makeFakeCatalogServices } from "./fake-services-catalog.js";
import { makeFakeCommerceServices } from "./fake-services-commerce.js";
import { makeFakePaymentServices } from "./fake-services-payment.js";
import { makeFakeReviewServices } from "./fake-services-review.js";
import { makeFakeSystemUpdate } from "./fake-services-system.js";
import type { FakeServicesState } from "./fake-services-state.js";

export type { FakeServicesState };

export function makeFakeServices(state: FakeServicesState) {
  return {
    ...makeFakeCatalogServices(state),
    ...makeFakeCommerceServices(state),
    ...makeFakePaymentServices(state),
    ...makeFakeReviewServices(state),
    systemUpdate: makeFakeSystemUpdate(),
  };
}
