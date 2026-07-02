-- 任务分派架构(2026-07-02)移除 staging 概念:apply 成功即落库,不再有
-- "待提交"中间态,workflow_runs / workflow_staged_changes 随之废弃。
-- 见 docs/superpowers/plans/2026-07-02-simplify-to-task-dispatcher.md D-5。
DROP TABLE IF EXISTS workflow_staged_changes;
DROP TABLE IF EXISTS workflow_runs;
