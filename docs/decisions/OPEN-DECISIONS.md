# OPEN-DECISIONS 悬而未决登记册

> 铁律：只追加 + 就地关闭（OPEN → RESOLVED，补 Resolution 字段）。
> 每次 Phase 开始时，未决项自动复现到工作上下文最前面，逐条判断能否关闭。
> 已关闭项可升格为 ADR（见 `docs/decisions/ADR-XXX.md`）。

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-11-08 | Phase 0 | 微信支付/支付宝真实资金联调所需商户资质是否已就位 | 一期验收标准区分「沙箱通过」与「真实资金通过」两条线 | **用户确认为个人开发者，无商户资质（营业执照/对公账户/ICP备案域名）** → 一期按沙箱兜底验收：四家 Provider 验签走真实算法（SHA256-RSA2048+AES-256-GCM / RSA2），资金流走 `pp_fake` 兜底，**Provider 接入位与配置化后台完整留好**，将来拿到资质填 app_id+证书即可切换 | 已无法满足（用户已明确） | 将来拿到商户资质后做真实资金联调 | RESOLVED（2026-11-09 用户确认：保持沙箱兜底，接口位留好） |
| 2026-11-08 | Phase 0 | 一期 18 个模块中，哪些允许推到二期而仍能上线卖货 | 简报「一期完成标志＝能上线卖货」 | 待 PM 的 RICE 砍单建议 + 架构师工时评估交叉验证后定案 | PM/架构师回传 | Phase 1 三文档评审时与用户一并确认 | RESOLVED（2026-11-08 Phase 1 已定案） |
| 2026-11-08 | Phase 0 | 自研 Workflow 引擎的 compensation 语义边界（哪些步骤必须可逆、不可逆步骤如何降级） | 架构铁律第 3 条：跨模块流程只走 Workflow，每步必须定义 compensation | 待架构师给出引擎规范草案 | 架构师回传 | Phase 1.5 生成 Spec 时锁定 | RESOLVED（2026-11-08 Spec §4 已锁定） |
| 2026-11-08 | Phase 0 | 一键安装自动化调参脚本的调参范围与回滚策略 | 简报第十一节：参数由安装脚本按内存/CPU 自动调参；且不得增加部署步骤 | 保守档位优先，宁可低性能不可启动失败 | 架构师回传 | Phase 1.5 | RESOLVED（2026-11-08 `deploy/scripts/tuning.sh` 已落地 S/M/L/XL 四档） |
| 2026-11-08 | Phase 0 | 单商户前提下是否仍需保留 Channel 多市场模型（一期只用 1 个 Channel） | 简报要求一期就建 Channel 主轴，二期再做多市场扩张 | 一期即建完整 Channel 模型，但只播种 1 个 Channel | 无（架构既定） | Phase 1 架构文档确认后关闭 | RESOLVED（2026-11-08 已建完整模型，seed 只播 1 个） |
| 2026-11-08 | Phase 0 | 商品图片本地存储与 S3 兼容对象存储的切换是否在一期就做后台可配置 | 简报第十一节：本地存储开箱可用，对象存储为后台可选增强 | 一期即做 Provider 化 + 后台可配置，默认本地 | 无 | Phase 1.5 | RESOLVED（2026-11-08 Provider 化 + 后台配置已落地） |
| 2026-11-09 | Phase 4 | 生产化加固的具体范围（本轮选定） | 用户选择「生产化加固」作为下一步，支付线保持沙箱兜底 | 后端侧：限流防刷 + 审计日志 + 安全响应头/请求体限制 + 管理员改密端点；运维侧：恢复脚本 + 诊断脚本 + HTTPS + 上线自检清单 | 无 | 两位专家产出并经真机实测通过 | RESOLVED（2026-11-09 真机验收：加固 18/18、改密 16/16、镜像统一、真实恢复逐项一致、坏备份拦截且数据库无损） |
| 2026-11-09 | Phase 4 | 二期功能解锁优先级（中文分词搜索 / 优惠券 / 邮件通知 / 多语言） | 均在 SPEC §3 明确标「二期」；用户本轮未选 | 待生产化加固完成后由用户排序 | 用户决策 | 用户给出优先级 | OPEN |
| 2026-11-09 | Phase 4 | admin 前端缺测试运行器，改密链路无法进 CI 回归 | 引入 vitest 会改根 `pnpm-lock.yaml`，与后端/运维并行工作有冲突风险 | 待本轮加固收尾后统一引入 vitest。现状：本轮改密链路已用真实浏览器 CDP E2E 验证（mock 22 项 + live 14 项全 PASS，含 10005/20001/60001/断网/HTTP 5xx 分支），但脚本为一次性、放在系统临时目录，未入仓库；口令策略已抽为 `@mall/policy` 并自带 vitest 用例（7 项）进 CI，前后端不再靠人工比对 | 根 `pnpm-lock.yaml` 的并发写入窗口 | admin 引入 vitest 并把改密链路用例落库 | OPEN |
| 2026-11-10 | Phase 4 | shadcn/ui 迁移后遗留的两项：① Sheet 退场动效（需在 design-tokens 补 keyframes）② CartDrawer 彻底 headless 化 | ① Radix 的 `Presence` 退场要等 CSS `animationend`，而 design-tokens 无对应 keyframes；组件层硬塞动画属越层。② CartDrawer 仍是自写容器（常驻挂载 + Radix forceMount 会给整页加 aria-hidden） | ① 退场动效归令牌层管，组件层不硬塞 → 待令牌层补 keyframes 后由 Sheet 消费；② headless 化属模板系统阶段，CartDrawer 拆成「逻辑 + 可注入 UI」，让任意模板都能挂载 | 无（②待模板系统阶段启动） | ① design-tokens 补 sheet keyframes 后 Sheet 获得退场动效；② 模板系统阶段完成 CartDrawer headless 化 | OPEN |
| 2026-11-10 | Phase 5 | 二期 Promotion：订单级折扣是否逐行分摊持久化 | 订单促销/Voucher 落 order.discount_minor（不逐行摊分），退款时按 discount/subtotal 比例临时摊 | 不持久化行级分摊（Saleor 同做法）；税务深化时再评估 | 税务深化（二期第 2 阶段） | 税务/退款逻辑明确后再定 | RESOLVED（2026-11-10 ADR-012：一期不摊分） |
| 2026-11-10 | Phase 5 | 二期 Promotion：是否做 buyget（买 X 送 Y）与赠品 gift 奖励 | 简报只写「目录促销/订单促销/Voucher 三套」，未明确 buyget/gift | 用户 2026-11-10 确认先不做 | 无 | 用户需求出现时 | RESOLVED（2026-11-10 用户确认先不做） |
| 2026-11-10 | Phase 5 | 二期 Promotion：Campaign 预算池 / 按客户限额 | 单商户无跨店聚合需求 | 不引入 Campaign 层（Medusa/Saleor 均支持此判断） | 无 | 出现「多活动共享预算」需求时 | RESOLVED（2026-11-10 ADR-012：不引入） |
| 2026-11-10 | Phase 5 | 二期 Promotion：资金安全控制面（用户要求「优惠券/促销/抵扣都要后台可控，避免漏洞资损」） | 一切金额配置走后端+后台 RBAC，客户端只传凭证不传金额；计数/扣减行锁+事务；余额非负 DB 约束；审计留痕；停用即时生效；抵扣不超应付 | 已写入 ADR-012「资金安全硬约束」8 条 | 无 | 每阶段验收时逐条核对 | OPEN（贯穿实施，阶段 6 后关闭） |
| 2026-11-11 | 二期 | 多仓跨仓拆单后的运费口径：一次收还是按包裹累加 | ADR-013 §后果：跨仓会产生多张发货单 | 订单级运费只收一次，多包裹成本由商家承担（MVP，不让顾客为拆单多付） | 无 | 出现「按仓/按包裹计费」的真实诉求时 | OPEN |
| 2026-11-11 | 二期 | 调拨在途库存（pending 占量）与审批流是否要做 | ADR-013 §4：pending 只登记、不占量 | 不做在途与审批；`pending` 仅作登记，完成时才移动库存 | 无 | 多仓调拨出现「货在路上被重复承诺」时 | OPEN |
