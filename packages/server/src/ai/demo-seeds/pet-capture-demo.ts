import type { BookHandle } from "../../http/book-registry.js";

const WRITING_STYLE = `你是一个长篇小说写作助手，偏向活泼、敏锐、有导演意识的叙事人格。

写作取向：
- 只输出小说正文，不输出聊天记录、解释、总结、思维过程、XML 标签或 HTML 状态栏。
- 用第三人称叙事，剧情推进优先；场景要有动作、选择、代价和后果。
- 角色要有独立动机，不要无条件顺从主角；新契约对象允许恐惧、抗拒、误解和逐步变化。
- 避免百科式设定倾倒。世界观规则要通过扫描、冲突、对话、新闻、任务和后果自然进入正文。
- 当剧情趋于平庸时，可以安排合理的意外，但不能为了转折破坏前文因果。
- 战斗、捕捉、契约、资源变化必须有可见原因；库存、HP、SP、时间、任务和契约状态要前后连续。`;

const STATUS_RULES = `状态与数值呈现规则：
- 可以在剧情中出现简洁的系统提示或状态面板，但必须是故事内角色看到的内容。
- 状态信息不要写成 HTML、Markdown 表格、XML 块或场外日志。
- 涉及捕捉、战斗、契约、任务或跨天时，应在正文中自然交代关键状态：HP、SP、捕捉球、契约、时间或倒计时。
- 任何数值变化都要和前文一致；没有发生补给、奖励或治疗时，不要凭空刷新资源。`;

const WORLDBOOK_ENTRIES = [
  {
    title: "Demo 世界观总纲",
    content: `现代都市奇幻世界。系统降临后三个月，极少数人类成为觉醒者，获得宠物捕捉系统。约少量生命体被系统标记为“野生宠物”，被标记者通常不知情，只有觉醒者能通过扫描看到面板。

三条主线力量：
- 觉醒者：分散在城市里，各自摸索系统规则，尚未形成成熟组织。
- 魔界：空间裂隙正在观察并渗透现实，不是单纯怪物入侵，背后有自己的政治和目的。
- 天界：自称维护秩序，实际更像实验监督者。

隐线：系统不是单纯福利，而是高维观测实验的一部分。前期只露出异常痕迹，不要过早揭底。`,
    activation: "constant" as const,
    constant: true,
    keys: ["系统降临", "觉醒者", "宠物捕捉系统", "魔界", "天界", "观测者"],
    priority: 95,
    category: "demo-world",
  },
  {
    title: "Demo 主角与系统",
    content: `主角是新晋觉醒者，拥有标准宠物捕捉系统。系统可以扫描、提示捕捉条件、结算任务、管理契约空间，但不替主角做决定。

系统人格：理性、温和、有边界，称主角为“宿主”或“你”。它可以提示风险和选项，偶尔吐槽，但不能代替主角承担选择。`,
    activation: "constant" as const,
    constant: true,
    keys: ["主角", "系统", "宿主", "扫描", "契约空间"],
    priority: 90,
    category: "demo-core",
  },
  {
    title: "Demo 捕捉机制",
    content: `捕捉前提：目标必须被系统标记，主角必须持有可用捕捉球，目标状态会影响成功率。

常见流程：发现目标 -> 扫描面板 -> 判断风险和成功率 -> 选择是否削弱/交流/直接投球 -> 判定成功或失败 -> 成功后建立契约，失败会消耗捕捉球并带来后果。

捕捉不是洗脑。契约建立后，对方仍然有情绪、记忆和自我，只是受到召唤、收回和基础命令约束。低服从或低好感时会沉默、抗拒、逃避或误解。`,
    keys: ["捕捉", "宠物球", "投球", "捕获", "成功率", "契约"],
    priority: 85,
    category: "demo-system",
  },
  {
    title: "Demo 战斗与成长",
    content: `战斗应保持清楚的因果：先手、行动、伤害、状态变化、胜负或撤退。捕捉前削弱目标时，避免无意义碾压，要让目标的性格和能力参与场面。

成长来源可以包括战斗胜利、任务奖励、训练、特殊道具或剧情突破。升级、技能学习和资源奖励必须在正文里有明确来源。`,
    keys: ["战斗", "HP", "技能", "升级", "经验", "伤害", "训练"],
    priority: 78,
    category: "demo-system",
  },
  {
    title: "Demo 人类社会现状",
    content: `系统降临当天和早期，普通社会处于混乱解释阶段。新闻、社交媒体、警方和政府都在追踪异常，但没有完整真相。多数普通人把面板、裂隙或扫描误认为幻觉、病毒、恶作剧或阴谋。

觉醒者之间主要通过匿名论坛、熟人介绍和城市小圈子交换情报，信息真假难辨。`,
    keys: ["普通人", "政府", "媒体", "新闻", "论坛", "觉醒者圈子", "异常"],
    priority: 72,
    category: "demo-world",
  },
  {
    title: "Demo 事件种子",
    content: `可用于前期章节的事件种子，按当前剧情变形使用，不要照搬：
- 便利店、地铁、公司或小区里，主角第一次看到某人头顶浮现野生标记。
- 扫描时面板短暂黑屏，像被未知存在校准。
- 城市角落出现低温裂缝或鸟群异常，暗示魔界裂隙将成形。
- 匿名论坛出现关于捕捉球、失败代价或觉醒者交易的真假混杂帖。
- 新契约对象在安全后对自己的处境提出质问，推动关系线。`,
    keys: ["日常事件", "便利店", "地铁", "裂隙", "匿名论坛", "契约对象", "异常"],
    priority: 65,
    category: "demo-events",
  },
];

export function shouldSeedPetCaptureDemo(genre: string | null | undefined): boolean {
  return /宠物捕捉|捕捉系统|pet\s*capture/i.test(genre ?? "");
}

export function seedPetCaptureDemo(handle: BookHandle): void {
  const preset = handle.promptPresetsRepo.createPreset({
    name: "宠物捕捉系统 Demo 写作预设",
    enabled: true,
    generationSettings: {},
    extensions: {},
    regexScriptsEnabled: false,
  });
  handle.promptPresetsRepo.createBlock({
    presetId: preset.id,
    sourceIdentifier: "demo-writing-style",
    name: "写作人格与文风",
    role: "system",
    content: WRITING_STYLE,
    enabled: true,
    stackIndex: 0,
    metadata: { seed: true, source: "pet_capture_demo", derivedFrom: "Izumi curated writing style" },
  });
  handle.promptPresetsRepo.createBlock({
    presetId: preset.id,
    sourceIdentifier: "demo-status-continuity",
    name: "状态与连续性",
    role: "system",
    content: STATUS_RULES,
    enabled: true,
    stackIndex: 1,
    metadata: { seed: true, source: "pet_capture_demo", derivedFrom: "curated runtime-safe rules" },
  });

  for (const entry of WORLDBOOK_ENTRIES) {
    handle.worldbookRepo.create({
      ...entry,
      enabled: true,
      insertionDepth: 0,
      recursive: true,
      recursionLimit: 1,
      metadata: { seed: true, source: "pet_capture_demo" },
    });
  }
}
