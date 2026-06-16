const META_BLOCK_NAMES = [
  "konatan_chat",
  "current_event",
  "progress",
  "analysis",
  "thinking",
  "instructions",
];

export function sanitizeChapterOutput(text: string): string {
  let cleaned = text;
  for (const name of META_BLOCK_NAMES) {
    const block = new RegExp(`\\n?\\s*<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>\\s*\\n?`, "gi");
    cleaned = cleaned.replace(block, "\n");
  }
  return cleaned
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
