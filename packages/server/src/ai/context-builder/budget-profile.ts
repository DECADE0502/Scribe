/**
 * 按写作模型的 contextWindow 阶梯换算写作上下文 token 预算,留 ~25-30% 给生成输出。
 * 没传 contextWindow(模型未知)时回退到 32k 保守值。
 */
export function pickWriteBudget(contextWindow: number | undefined): number {
  if (!contextWindow) return 32_000;
  if (contextWindow >= 500_000) return 400_000;
  if (contextWindow >= 200_000) return 80_000;
  if (contextWindow >= 64_000) return 32_000;
  return Math.max(8_000, Math.floor(contextWindow * 0.5));
}
