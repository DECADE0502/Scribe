# Scribe Documentation

这一级目录保存项目说明、规格、实施计划和交接材料。新同学先按下面顺序读,不要直接从源码开始。

## 建议阅读顺序

1. `docs/superpowers/specs/2026-06-17-scribe-ultimate-product-goal.md`
   - 项目最终目标。先确认 Scribe 要做成什么,以及为什么不能继续针对单本样例优化。
2. `docs/superpowers/plans/2026-06-17-scribe-phase1-generic-continuity-gates.md`
   - 当前 Phase 1 的底层纠偏计划:通用 hard-fact 门禁、跨题材测试、失败阻断长期记忆写入。
3. `docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md`
   - 后续阶段路线图。说明 Phase 1 之后还要补哪些能力。
4. `docs/HANDOFF-codex.md`
   - 当前分支交接文档。记录已经完成的工作、验证命令、风险和下一步。
5. `docs/_implementation-notes.md`
   - 历史实现期 backlog。主要给继续派单或排查旧设计债时使用。

## 文档边界

- `specs/` 写目标和设计原则。
- `plans/` 写可执行实施计划。
- `HANDOFF-codex.md` 写当前状态,要随关键提交更新。
- `_backups/` 只保留历史归档,不作为当前执行依据。
