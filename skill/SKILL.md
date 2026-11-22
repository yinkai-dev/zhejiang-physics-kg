---
name: 浙江物理知识图谱
description: 面向 AI 智能体的浙江高考物理六维属性知识图谱（Agent-Native Physics KG）：支持精细考点/经典物理模型/21个必做实验检索、弹性教学进度“零超纲”范围计算、跨卷拓扑选题、错题迷思诊断与试卷子问级推理链挂载。当需要按物理模型/细分考点查题组卷、判断题目是否超纲、诊断学生物理错因或为物理题目挂载结构化图谱标注时调用。
---

# 浙江物理知识图谱

本技能提供浙江高考物理（新课标 2017 版 2020 修订 · 人教版 2019 全六册）的**权威受控知识图谱与确定性推理查询接口**，单一可信源位于独立的 `zhejiang-physics-kg` 图谱仓库（可通过环境变量 `ZJ_PHYSICS_KG_ROOT` 或本技能 `SKILL.md` 真实物理路径的上级目录定位）。

---

## 一、 渐进式阅读协议（Progressive Context Loading）

1. **首轮意图对齐（L0 路由）**：先读取同目录下的 [references/L0-map.md](references/L0-map.md)（约 4K Tokens），一次性掌握全图谱 591 个受控节点的语义 ID（`unit.*` / `law.*` / `model.*` / `exp.*` / `expskill.*` / `method.*` / `trap.*` / `slot.*`）及人教版全六册 27 章精确页码范围。
2. **局部契约展开（L1 精读）**：选定 1~5 个候选节点后，运行 `inspect` 拉取标准公式、严格适用条件护栏、教材起止页码锚点（`page_range` / `textbook_anchor`）、易混辨析对（`CONTRASTS_WITH`）与高频审题陷阱，**不要猜测节点 ID 或手写模糊关键词搜题**。
3. **人教版数字教材库深潜（L1.5 溯源，可选）**：当任务涉及核对教材原始定义、侧边栏旁批、课标实验标准步骤、课后母题（《练习与应用》/《复习与提高》A·B 组）或《科学漫步》/《STSE》/《拓展学习》出处时，若本机配置了结构化教材库目录（环境变量 `ZJ_PHYSICS_TEXTBOOK_CORPUS`），可通过 `python <TEXTBOOK_CORPUS>/scripts/textbook_cli.py unit <unit_id>` 或 `search <关键词>` 直接按图谱 `unit.*` 节点调取核验后的教材结构化卡片。
4. **拓扑选题与零超纲门禁（L2 实证）**：传入学校实际已学章节选择器（支持任意选修讲授顺序，如 `b1,b2,b3,s2` 或精确到节 `unit.s1.c1.s3`），由 `match` 执行 100% 确定性零超纲筛选。

---

## 二、 核心 CLI 原语速查

在图谱仓库根目录（或任意目录指定 `<KG_ROOT>/scripts/cli.mjs`）调用：

```powershell
# 若通过软链接调用，可先从技能目录解析物理仓库根路径
$kg = "<KG_ROOT>/scripts/cli.mjs"

# 1. 查看图谱版本、规模与 135 卷五级数据集切分状态
node $kg stats

# 2. 按物理概念、俗称、题面装置词混合定位节点
node $kg locate "不等间距 双杆"
node $kg locate "水银柱" --types PhysicalModel

# 3. 查看节点的完整物理契约卡（公式、适用条件、先修闭包、辨析与陷阱）
node $kg inspect model.ind.unequal_rail_dual_rod law.m7.momentum_conservation

# 4. 计算特定教学进度下的“零超纲”解锁白名单（适配浙江各校不同选修顺序）
node $kg scope b1,b2,b3,s2

# 5. 在已挂载题库中执行拓扑选题 + 零超纲硬过滤（母模型自动展开子变式）
node $kg match --any model.mag.bounded_mag_chord_tangent --learned b1,b2,b3,s2 --limit 20

# 6. 错题迷思诊断与回退补救路径查询
node $kg diagnose "动量守恒 圆弧槽"

# 7. 生成浙江 18 题标准仿真卷或专题突破蓝图
node $kg blueprint --mode zhejiang_18_mock
```

---

## 三、 数据治理与防泄漏红线

1. **封存测试集硬锁**：`splits/dataset-splits.json` 中标记为 `test_id`（10 卷）与 `test_ood`（10 卷，含 2026.06 选考真题与最新 2611 一模）的 20 套试卷受 `split-guard.mjs` 保护。在本体调优与提示词开发阶段严禁传入 `--unlock-heldout-test` 偷看测试集内容。
2. **原题包零触碰与指纹强绑定**：所有题目标注保存在 `annotations/papers/<paper_id>.json`，绑定 `question_sha256`，绝不修改上游冻结题包；非选择题必须包含 `subquestions` 子问级推理链。
3. **严禁生造野生节点 ID**：标注只能引用受控本体 ID；遇到本体未覆盖的新物理模型或微技能，记录在题目 `oov_proposals` 字段供集中评审。
