# 浙江高考物理 Agent-Native 知识图谱 (`zhejiang-physics-kg`)

面向 AI 智能体与浙江高考物理高三题库（135 卷 / 2,488 题）构建的**六维正交属性知识图谱（Property Knowledge Graph）**单一可信源仓库。当前正式签发版本：**`v1.1.0-release`**（已完成人教版全六册 786 页真书目录、印刷页码区间与官方索引词条权威校准）。

## 核心规模与特性

1. **六维正交受控本体（`ontology/`，共 591 个节点 / 1,355 条有向边）**：
   - `unit.*`：人教版普通高中教科书·物理（必修 1–3 + 选择性必修 1–3）全六册 **27 章 / 125 节**（章与节双层共 152 个教材单元节点，100% 绑定真书精确起止印刷页码 `page_range` 与节内栏目清单 `column_titles`）；
   - `law.*`：18 个专题模块、**137 个核心概念与规律算子**（含 171 个 MathJax 零报错标准 LaTeX 公式、适用条件护栏、`REQUIRES_PREREQ` 先修 DAG，其中 **91 个** 核心概念规律已绑定教材书末《索引》首次定义页码 `textbook_anchor`）；
   - `model.*`：6 大模型族、**108 个浙江经典物理模型**（含题面触发词、底层规律、母子变式、易混辨析与浙江题位映射）；
   - `exp.*` / `expskill.*`：**24 个课标必做与高频实验** + **25 个跨实验通用微技能**（读数、电路选型、化曲为直、系统误差代数证明）；
   - `method.*`：**36 个**科学思想方法、物理图像斜率面积解码与数学几何工具；
   - `trap.*`：**96 个**高频审题陷阱与认知迷思（含一问判别探针与回退巩固目标）；
   - `slot.*`：**13 个**浙江选考 18 题卷 / 20 题卷同构功能题位簇（与题号强绑定解耦）。
2. **防过拟合五级数据集切分与测试集硬锁（`splits/dataset-splits.json`）**：
   - `train_seed`（12 卷）$\to$ `dev_a`（10 卷）$\to$ `dev_b`（10 卷）$\to$ 开发期硬锁封存 `test_id`（10 卷，盲测 OOV `1.08%`）+ `test_ood`（10 卷：2026.06 真题 + 2611 一模等，盲测 OOV `1.11%`）$\to$ `prod_backfill`（72 卷）+ `prod_unanswered`（11 卷）。
   - 当前已完成 **52 卷 / 958 题** 实证深标与 `question_sha256` 指纹绑定，非选择题均细化至子问级推理链，三大教学进度截面（`b1` / `b1,b2` / `b1,b2,b3,s2`）审计超纲泄漏率均为 **`0.00%`**。
3. **零外部重型依赖编译与单向同步**：
   - 编译生成 `dist/kg-bundle.json`、`dist/agent/L0-map.md` 与 `dist/web/kg-nav.json`，配合 `skill/SKILL.md` 中文技能单向赋能静态题库网站与 MCP 出卷/答疑服务。

## 仓库目录结构

```text
├── ontology/       # 六维正交受控本体 JSON（单一可信源）
├── splits/         # 135 卷五级隔离切分清单与封存测试集声明
├── annotations/    # 按卷组织的题目图谱挂载与子问推理链（绑定 question_sha256，不含版权原题面）
├── src/            # 核心加载、严格校验、封存守卫、编译打包、检索诊断与评估引擎
├── scripts/        # CLI 查询原语（locate/inspect/scope/match/diagnose/blueprint）、校验、构建与下游同步脚本
├── dist/           # 编译产物（kg-bundle.json、L0 全景图、traps-index.md、web 导航投影）
├── skill/          # Agent-Native 中文全局技能与 L0/L1 渐进式上下文参考
├── reports/        # K1–K4 分集迭代、双盲一致率、盲题预测与零超纲审计报告快照
└── tests/          # 6 项核心不变量自动化门禁测试
```

## 常用命令

```powershell
# 可选：若题库仓库不在同级目录 `../yinkai的浙江高考物理题库`，先指定路径
$env:ZJ_PHYSICS_BANK_ROOT = "/path/to/yinkai的浙江高考物理题库"

npm run validate      # 校验本体完整性、DAG 零环路及已落盘试卷标注
npm run check:math    # 使用 MathJax 校验本体全部公式零语法错误
npm run build         # 编译生成 dist/ 全套产物与技能 L0 全景图
npm test              # 运行自动化单元测试
npm run sync:dry      # 预演向题库仓库单向导出静态导航投影
node scripts/cli.mjs stats   # 查看图谱规模与五级切分进度
```
