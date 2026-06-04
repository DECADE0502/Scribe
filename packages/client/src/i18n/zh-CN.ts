export const zhCN = {
  app: { title: "Scribe 小说引擎", loading: "加载中..." },
  library: { newBook: "新建书", emptyHint: "还没有作品,点上方按钮新建一本" },
  common: { confirm: "确认", cancel: "取消", save: "保存", delete: "删除", retry: "重试" },
} as const;
export type I18n = typeof zhCN;
export const t = zhCN;
