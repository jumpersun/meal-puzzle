# 套餐拼图：参赛提交材料

项目仓库：[jumpersun/meal-puzzle](https://github.com/jumpersun/meal-puzzle)。

报名申请已于 **2026-10-13 10:45（北京时间）** 提交：[官方 Issue #592](https://github.com/M-China/mcd-developer-innovation-challenge/issues/592)。官方账号 `M-China-Official` 已于 **2026-10-13 10:59（北京时间）** 回复“您的作品已成功参赛”。[查看官方确认](https://github.com/M-China/mcd-developer-innovation-challenge/issues/592#issuecomment-6137220793)。

## 项目定位

- 项目名：套餐拼图 · 一桌刚刚好
- 方向：生活趣味 / 多人拼餐决策辅助
- 一句话：把每个人想吃的，拼成有真实选配、官方核价和明确归属的一桌。
- 目标用户：1–6 位朋友、同事或家庭成员；由一人操作页面，一起商量到店自取餐单。
- 核心特点：心愿驱动候选生成、官方整单核价、按心愿分餐、条件与缺口透明。
- 技术：原生 JavaScript + Node.js / Worker，直连麦当劳 MCP；不依赖额外 LLM。

## 已提交的 Issue

以下标题与正文对应[官方 Issue #592](https://github.com/M-China/mcd-developer-innovation-challenge/issues/592)。

标题：

```text
【参赛提交】套餐拼图 · 一桌刚刚好
```

正文：

```text
【参赛提交】
项目名称：套餐拼图 · 一桌刚刚好
项目地址：https://github.com/jumpersun/meal-puzzle
项目简介：你想要咖啡，他想吃薯条。套餐拼图收集每位饭搭子的餐品心愿，从所选麦当劳餐厅的实时菜单和可换搭配中组合候选，逐桌调用官方核价，显示预算、未满足心愿和优惠条件。选中方案后按心愿分到各人的餐盘，还能继续换搭配、调整归属，生成可分享的真实餐单。支持早餐与午餐场景，最多 6 位搭子；只查询与整理，不下单、不支付。
```

## 30 秒介绍

> 一起吃麦当劳，难的不是找菜单，而是把不同人的心愿放到同一桌。套餐拼图先问每个人想吃什么，再结合真实门店套餐搭配出几桌方案，向官方逐桌核价。每桌满足了多少、还差什么、有没有多余、优惠有什么条件，都直接展示。选中后自动分给对应的人，改杯咖啡、换份小食，再核一次价，就能带走一份清楚的餐单。

## 两分钟演示脚本

| 时间 | 操作 | 展示重点 |
| --- | --- | --- |
| 0:00–0:15 | 介绍三位搭子，选择当前营业餐厅 | 真实门店与实时菜单 |
| 0:15–0:35 | 点击示例心愿，按需要修改，填写预算 | 当前餐期可用示例、每个人不同需求 |
| 0:35–1:00 | 点击“帮我们拼一桌”，等待真实核价 | 候选商品图、实际总价、满足度、额外份数与预算差额 |
| 1:00–1:20 | 展开一个方案详情 | 具体冷热/杯型、购卡条件与本次报价独立展示 |
| 1:20–1:40 | 选用，查看餐盘，换一个选配 | 按心愿分配、重新核价、未变餐品归属保留 |
| 1:40–2:00 | 按心愿再分好，生成真实餐单 | 门店、选配、归属、时间与优惠条件随清单保留 |

演示时使用当前门店和餐期的数据，展示接口实际返回的价格与未满足心愿。

## 提交文件对应

| 活动要求 | 本仓库材料 |
| --- | --- |
| 项目介绍、安装、示例、用户 | `README.md` |
| 官方参赛声明 | `CONTEST_DECLARATION.md`（原样保留） |
| MCP Server / Tool / 流程 / 价值 | `MCP_INTEGRATION.md` |
| 环境变量占位的配置 | `mcp-config.example.json` |
| 可运行源码与检查 | `public/`、`server/`、`worker/`、`tests/`、`server.mjs`、`package.json` |
| 展示与证据 | `docs/screenshots/`、`docs/VERIFICATION.md` |
| 授权和素材范围 | `LICENSE`、`ASSETS.md` |

## 运行与活动规则

按 [README 的本地运行步骤](README.md#立即在本地使用)配置自己的 Token，即可体验真实菜单、拼餐与核价流程。验收截图与记录见上表。

报名截止为 **2026-10-25 23:59（北京时间）**。文件要求与排名方式见[官方活动规则](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md)。
