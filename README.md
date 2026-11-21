# 浙江高考物理 Agent-Native 知识图谱 (`zhejiang-physics-kg`)

面向 AI 智能体与浙江高考物理高三题库（135 卷 / 2,488 题）构建的**六维正交属性知识图谱（Property Knowledge Graph）**单一可信源仓库。

## 核心特性

1. **六维正交受控本体（`ontology/`）**：
   - `unit.*`：人教版（2019）必修 1–3 + 选择性必修 1–3 全六册 **27 章 / 129 节**（章与节双层共 156 个教材单元节点）；
   - `law.*`：18 个专题模块、**136 个核心概念与规律算子**（含标准 LaTeX 公式、严格适用条件护栏与 `REQUIRES_PREREQ` 先修 DAG）；
   - `model.*`：6 大模型族、**92 个浙江经典物理模型**（含题面触发词、底层规律、母子变式、易混辨析与浙江题位映射）；
   - `exp.*` / `expskill.*`：**24 个课标必做与高频实验** + **25 个跨实验通用微技能**（读数、电路选型、化曲为直、系统误差代数证明）；
   - `method.*`：**36 个**科学思想方法、14 类物理图像斜率面积解码与 12 类数学几何工具；
   - `trap.*`：**90 个**高频审题陷阱与认知迷思（含一问判别探针与回退巩固目标）；
   - `slot.*`：**12 个**浙江选考 18 题卷 / 20 题卷同构功能题位簇。
2. **防过拟合五级数据集切分与测试集硬锁（`splits/dataset-splits.json`）**：
   - `train_seed`（12 卷）$\to$ `dev_a`（10 卷）$\to$ `dev_b`（10 卷）$\to$ 严格封存 `test_id`（10 卷）+ `test_ood`（10 卷：2026.06 真题 + 最新 2611 一模）$\to$ `prod_backfill`（72 卷）+ `prod_unanswered`（11 卷）。
3. **零外部重型依赖编译与单向同步**：
   - 编译生成 `dist/kg-bundle.json`、`dist/agent/L0-map.md` 与 `dist/web/kg-nav.json`，单向赋能静态题库网站与 MCP 出卷/答疑服务。

## 常用命令

```powershell
npm run splits:init   # 初始化 135 卷确定性五级切分清单
npm run validate      # 校验本体完整性、DAG 零环路及已落盘试卷标注
npm run check:math    # 使用 MathJax 校验本体全部公式零语法错误
npm run build         # 编译生成 dist/ 全套产物与技能 L0 全景图
npm test              # 运行自动化单元测试
npm run sync:dry      # 预演向题库仓库单向导出静态导航投影
```
