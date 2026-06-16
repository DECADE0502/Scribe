import { resolveAppPaths } from "../src/config/paths.js";
import { createBookRegistry } from "../src/http/book-registry.js";

const paths = resolveAppPaths({ env: process.env });
const registry = createBookRegistry({ paths });

try {
  const book = registry.booksRepo.create({
    title: "雨井回声",
    genre: "近未来城市悬疑",
  });
  const handle = registry.open(book.id);
  handle.bookMetaRepo.set("title", "雨井回声");
  handle.bookMetaRepo.set("genre", "近未来城市悬疑");
  handle.bookMetaRepo.set(
    "premise",
    "暴雨频发的近未来城市里，排水调度员许澜在南港泵站夜班中听见一段不该存在的井下回声，由此追查十年前内涝事故和当下城市系统被人为操纵的证据。",
  );
  handle.bookMetaRepo.set("tone", "冷静、潮湿、压迫，技术细节和民间传说并置");

  const entries = [
    {
      title: "创作契约",
      content:
        "这本书是近未来城市悬疑，不使用超能力、修仙或玄学解决问题。所有异常都必须能同时被解释为城市基础设施故障、管理失职、信息污染或人的选择。叙述保持冷静、克制、带一点潮湿的压迫感。",
      activation: "constant" as const,
      constant: true,
      priority: 100,
      category: "style",
      keys: [],
      recursive: false,
      recursionLimit: 0,
    },
    {
      title: "主角改稿决策",
      content:
        "我放弃“调查记者”主角，改为市政排水系统夜班调度员许澜。理由：她能合理接触雨量传感器、泵站日志、井盖报警、应急会议和事故责任链，也更容易把私人创伤和城市系统绑定。",
      activation: "constant" as const,
      constant: true,
      priority: 95,
      category: "author_decision",
      keys: ["许澜", "排水调度员"],
      recursive: false,
      recursionLimit: 0,
    },
    {
      title: "雨井传说",
      content:
        "老城区有“雨井会回声”的传说：暴雨夜对着特定雨水井说出秘密，三天内会从别人的手机、广播或泵站语音里听见同一句话。世界书要求：传说不能被证实为鬼神，只能作为信息泄漏、录音复现、管网声学和群体恐慌的交叉现象。",
      activation: "triggered" as const,
      constant: false,
      priority: 90,
      category: "mystery",
      keys: ["雨井", "回声", "暴雨夜"],
      recursive: true,
      recursionLimit: 1,
    },
    {
      title: "南港泵站",
      content:
        "南港泵站是第一卷核心地点。它管理老城低洼片区的排涝，十年前一次内涝事故中有七人死亡，官方记录把原因归为极端天气，但内部日志显示事故前十三分钟有人手动关闭过一组闸门。",
      activation: "triggered" as const,
      constant: false,
      priority: 85,
      category: "location",
      keys: ["南港泵站", "闸门", "内涝事故"],
      recursive: true,
      recursionLimit: 1,
    },
    {
      title: "许澜人物底线",
      content:
        "许澜不是天才侦探。她谨慎、怕担责、擅长读系统日志和班组语气。她的缺点是习惯把人当成流程节点，所以第一章要让她先误判一个真实的人。",
      activation: "triggered" as const,
      constant: false,
      priority: 88,
      category: "character",
      keys: ["许澜", "系统日志", "误判"],
      recursive: false,
      recursionLimit: 0,
    },
  ];

  handle.worldbookRepo.create({
    title: "Core book seed",
    content: "Title: 雨井回声\nGenre: 近未来城市悬疑",
    activation: "constant",
    constant: true,
    priority: 100,
    category: "core",
    metadata: { seed: true, source: "script" },
  });
  for (const entry of entries) handle.worldbookRepo.create(entry);

  handle.charactersRepo.create({
    name: "许澜",
    role: "protagonist",
    baseData: {
      background: "市政排水系统夜班调度员，熟悉泵站日志、雨量传感器和应急流程。",
      motivation: "她想证明南港泵站十年前事故并非单纯天灾，也想弄清父亲当年被处分是否另有隐情。",
      languageHabits: "说话短，先报时间、地点、数据，再讲判断。",
    },
    currentState: { location: "南港调度中心", pressure: "怕再次误判导致伤亡" },
  });
  handle.outlineRepo.create({
    parentId: null,
    level: "volume",
    title: "第一卷：井下回声",
    summary:
      "许澜从一次暴雨夜报警开始，发现南港泵站日志和雨井传说之间存在人为制造的重合，逐步逼近十年前内涝事故的责任链。",
    status: "planned",
    sortOrder: 0,
    metadata: null,
  });

  console.log(JSON.stringify({
    bookId: book.id,
    appRoot: paths.appRoot,
    workspaceDb: paths.workspaceDb(book.id),
    worldbookCount: handle.worldbookRepo.list().length,
  }, null, 2));
} finally {
  registry.closeAll();
}
