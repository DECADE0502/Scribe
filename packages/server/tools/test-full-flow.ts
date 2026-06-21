/**
 * 完整写作流程测试:创建新书 → 写第1-3章 → 检查记忆与连续性
 * 用法: tsx tools/test-full-flow.ts
 */
const BASE = "http://127.0.0.1:6790/api";

async function main() {
  // 1. 创建新书
  const createRes = await fetch(`${BASE}/books`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "雾城档案", genre: "都市悬疑" }),
  });
  const book = (await createRes.json()) as { id: string };
  console.log(`\n=== 书创建成功: ${book.id} ===\n`);
  const bookBase = `${BASE}/books/${book.id}`;

  // 2. 通过对话设置 premise 和 tone
  console.log("=== 通过对话设置设定 ===");
  const onboardRes = await fetch(`${bookBase}/conversation?mode=chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message:
        "请设置这本书的设定。premise：雾城是一座常年被雾气笼罩的沿海城市。私家侦探沈默在调查一起失踪案时，发现案件牵涉到一个名为「灰雾会」的神秘组织。tone：冷硬派推理、氛围压抑、节奏紧凑、对话简洁。主角沈默：前刑警，因搭档殉职辞职后开私人侦探所，话少，喜欢用反问，偶尔冷幽默。",
    }),
  });
  if (onboardRes.status === 200) {
    // 读取 SSE 流直到 done
    const onboardText = await onboardRes.text();
    const hasDone = onboardText.includes('"type":"done"');
    console.log("设定对话完成:", hasDone ? "成功" : "可能未完成");
  } else {
    console.log("设定对话失败:", onboardRes.status);
  }

  // 3. 写第1-3章
  for (let chapterNo = 1; chapterNo <= 3; chapterNo++) {
    console.log(`\n--- 写第 ${chapterNo} 章 ---`);
    const intents = [
      "第一章。沈默接到李明妻子的委托，前往李明最后出现的旧城区调查。建立沈默的侦探所、雾城氛围、以及李明失踪的关键线索。沈默手头有5000元调查经费。",
      "第二章。沈默深入旧城区，找到李明租住的老式公寓。在公寓里发现李明的笔记本电脑和一本加密日记。沈默的经费消耗了500元（打车和买通房东）。注意保持经费数字连续。",
      "第三章。沈默破解了李明电脑里的部分数据，发现「灰雾会」的名字和一张雾城地下管道图。经费又消耗了300元（请线人吃饭）。注意保持经费递减的连续性。",
    ];

    const writeRes = await fetch(`${bookBase}/chapters/${chapterNo}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: intents[chapterNo - 1] }),
    });

    if (writeRes.status !== 200) {
      console.error(`第 ${chapterNo} 章写入失败: ${writeRes.status}`);
      const errText = await writeRes.text();
      console.error(errText.slice(0, 500));
      return;
    }

    // 解析 SSE 流
    const text = await writeRes.text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => {
        try { return JSON.parse(line.slice(6)); } catch { return null; }
      })
      .filter(Boolean) as any[];

    const chapterText = events
      .filter((ev) => ev.type === "text_delta")
      .map((ev) => ev.delta ?? "")
      .join("");

    const auditEnd = events.find((ev) => ev.type === "tool_call_end" && ev.toolName === "chapter_audit");
    const hardFactGate = events.find((ev) => ev.type === "tool_call_end" && ev.toolName === "hard_fact_gate");
    const recordState = events.find((ev) => ev.type === "tool_call_end" && ev.toolName === "record_chapter_state");
    const repairEnd = events.find((ev) => ev.type === "tool_call_end" && ev.toolName === "chapter_repair");
    const errors = events.filter((ev) => ev.type === "error");

    const wordCount = (chapterText.match(/[\u4e00-\u9fff]/g)?.length ?? 0) + (chapterText.match(/[A-Za-z]+/g)?.length ?? 0);

    console.log(`  字数: ${wordCount}`);
    console.log(`  审计: verdict=${auditEnd?.result?.verdict ?? "unknown"}, issues=${auditEnd?.result?.issuesCount ?? 0}`);
    if (repairEnd) {
      console.log(`  修复: success=${repairEnd?.result?.success}, reason=${repairEnd?.result?.reason ?? "none"}`);
    }
    if (hardFactGate) {
      const gate = hardFactGate.result;
      console.log(`  硬事实闸门: passed=${gate?.passed}, blockingIssues=${gate?.blockingIssues?.length ?? 0}`);
      if (gate?.blockingIssues?.length > 0) {
        for (const issue of gate.blockingIssues) {
          console.log(`    - ${issue}`);
        }
      }
    } else {
      console.log(`  硬事实闸门: (未触发)`);
    }
    if (recordState) {
      console.log(`  状态记录: success=${recordState?.result?.success}`);
    } else {
      console.log(`  状态记录: (未触发)`);
    }
    if (errors.length > 0) {
      console.log(`  错误: ${errors.length} 个`);
      for (const err of errors) {
        console.log(`    - ${err.errorClass}: ${err.message?.slice(0, 100)}`);
      }
    }

    // 输出前300字
    console.log(`  正文前300字: ${chapterText.slice(0, 300)}...`);
  }

  // 4. 检查记忆
  console.log("\n\n=== 检查记忆 ===\n");
  const sidebarRes = await fetch(`${bookBase}/sidebar`);
  if (sidebarRes.status === 200) {
    const sidebar = (await sidebarRes.json()) as any;
    if (sidebar.characters) {
      console.log("角色状态:");
      for (const c of sidebar.characters) {
        console.log(`  ${c.name}: currentState=${JSON.stringify(c.currentState ?? {})}`);
      }
    }
    if (sidebar.foreshadowing) {
      console.log(`伏笔: ${sidebar.foreshadowing.length} 条`);
      for (const f of sidebar.foreshadowing) {
        console.log(`  - [${f.status}] ${f.label}: ${f.description?.slice(0, 60)}`);
      }
    }
    if (sidebar.genreSections) {
      console.log(`通用记录集合: ${sidebar.genreSections.length} 个`);
      for (const gs of sidebar.genreSections) {
        console.log(`  - ${gs.section.name}: ${gs.items?.length ?? 0} 条`);
      }
    }
  }

  // 5. 输出章节内容摘要
  console.log("\n\n=== 章节正文摘要 ===\n");
  for (let chapterNo = 1; chapterNo <= 3; chapterNo++) {
    const chapRes = await fetch(`${bookBase}/chapters/${chapterNo}`);
    if (chapRes.status === 200) {
      const chap = (await chapRes.json()) as any;
      const wc = chap.content?.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
      console.log(`\n--- 第 ${chapterNo} 章 (${wc}字) ---`);
      console.log(chap.content?.slice(0, 400) + "...\n");
    }
  }

  console.log("\n=== 完整流程结束 ===\n");
}

main().catch((e) => {
  console.error("测试失败:", e);
  process.exitCode = 1;
});
