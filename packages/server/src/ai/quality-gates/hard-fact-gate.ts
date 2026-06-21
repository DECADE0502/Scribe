import {
  resolveIdentityFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
} from "@scribe/shared";
import type { HardFactClaimOutput } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import type { RepairContext } from "../prompts/repair-chapter.js";
import { extractArchiveHardFacts } from "./archive-hard-facts.js";
import {
  extractChapterClaimsFromText,
  extractClaimsFromAudit,
} from "./extract-chapter-claims.js";
import { runQualityGatePipeline } from "./pipeline.js";

/**
 * 硬事实闸门质量门禁结果。
 * 写作完成后传给 recordChapterState，如果 passed=false 则阻断状态记录。
 */
export interface HardFactGateResult {
  passed: boolean;
  blockingIssues: string[];
}

export interface HardFactQualityGateInput {
  chapterNo: number;
  chapterContent: string;
  stage: "draft" | "repair";
  auditVerdict: string;
  /** audit 模型提取的硬事实声明（可选，如果没有则只用确定性提取） */
  auditHardFacts?: HardFactClaimOutput[];
}

/**
 * 创建一个可直接传入 writeWithAudit 的 qualityGate 函数。
 *
 * 该函数：
 * 1. 从角色状态/通用记录/时间线提取 priorFacts（已有的硬事实）
 * 2. 从 audit 输出的 hardFacts + 确定性文本搜索提取 currentClaims
 * 3. 用 runQualityGatePipeline 比较，返回 repair issues
 *
 * 完全通用，不依赖任何题材词汇。任何书的任何属性都会被检测。
 */
export function createHardFactQualityGate(deps: {
  handle: BookHandle;
}): (input: HardFactQualityGateInput) => Promise<RepairContext["issues"]> {
  const { handle } = deps;

  return async (input) => {
    // 1. 提取 priorFacts
    const priorFacts = extractArchiveHardFacts({
      characters: handle.charactersRepo.list().map((c) => ({
        name: c.name,
        currentState: c.currentState ?? {},
      })),
      timelineEvents: handle.timelineRepo?.listAll?.() ?? [],
      genericRecords: handle.genreSectionsRepo.listSections().flatMap((section) =>
        handle.genreSectionsRepo
          .listItems(section.id)
          .map((item) => ({
            collectionName: section.name,
            identity:
              resolveItemIdentityKey(section, item.data) ??
              resolveItemLabel(section, item.data, "?"),
            data: item.data,
          })),
      ),
    });

    if (priorFacts.length === 0) return []; // 没有已有硬事实，无法比较

    // 2. 提取 currentClaims
    // 2a. 从 audit 输出提取
    const auditClaims = input.auditHardFacts
      ? extractClaimsFromAudit(input.auditHardFacts, input.chapterNo)
      : [];

    // 2b. 确定性提取：从正文中搜索 priorFacts 里已知属性的当前值
    const deterministicClaims = extractChapterClaimsFromText(
      input.chapterContent,
      priorFacts,
      input.chapterNo,
    );

    // 合并：确定性提取的优先级更高（confidence 0.9 > 0.8），
    // 如果两者对同一 entity+attribute 给出不同值，以确定性提取为准
    const claimMap = new Map<string, (typeof auditClaims)[number]>();
    for (const claim of auditClaims) {
      const key = `${claim.entity}::${claim.attribute}`;
      claimMap.set(key, claim);
    }
    for (const claim of deterministicClaims) {
      const key = `${claim.entity}::${claim.attribute}`;
      claimMap.set(key, claim); // 覆盖 audit 提取
    }
    const currentClaims = [...claimMap.values()];

    if (currentClaims.length === 0) return []; // 本章没有提及任何已知硬事实

    // 3. 运行 pipeline
    const result = runQualityGatePipeline({
      priorFacts,
      currentClaims,
    });

    return result.repairIssues;
  };
}

/**
 * 从 qualityGate 返回的 issues 里提取最终的 gate 结果。
 * 如果有 critical issues，则 passed=false，阻断状态记录。
 */
export function buildHardFactGateResult(
  issues: RepairContext["issues"],
): HardFactGateResult {
  const blockingIssues = issues
    .filter((issue) => issue.severity === "critical")
    .map((issue) => issue.note);
  return {
    passed: blockingIssues.length === 0,
    blockingIssues,
  };
}
