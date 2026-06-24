import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionMode, ExecutionPolicy } from "@scribe/shared";
import { t } from "../../i18n/zh-CN.js";
import { useConversationStore, type ChatMessage } from "../../stores/conversation.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";
import { Message } from "./message.js";
import { StreamingMessage } from "./streaming-message.js";
import { SlashSuggestions } from "./slash-suggestions.js";
import { ExecutionModeSelector } from "./execution-mode-selector.js";
import { ExecutionConfirmationCard } from "./execution-confirmation-card.js";

export type StreamFn = (opts: StartStreamOptions) => SseStreamHandle;

export interface ConversationPaneProps {
  bookId: string;
  endpoint?: (bookId: string) => string;
  streamFn?: StreamFn;
}

interface SendOptions {
  executionModeOverride?: ExecutionMode;
  appendUser?: boolean;
  displayContent?: string;
  source?: "chat" | "onboard" | "asset_audit";
  target?: Record<string, unknown>;
}

const PHASE_LABELS: Record<string, string> = {
  thinking: "理解需求",
  executing: "执行变更",
  validating: "验收变更",
  waiting_user: "等待确认",
  repairing: "修复问题",
  completed: "完成",
};

const ASSET_AUDIT_OPTIONS = [
  { id: "all", label: "全部资产", assets: ["all"] },
  { id: "elements", label: "元素", assets: ["worldbook", "foreshadowing", "timeline"] },
  { id: "story", label: "剧情", assets: ["chapters", "outline", "timeline"] },
  { id: "setting", label: "设定", assets: ["worldbook", "timeline", "foreshadowing"] },
  { id: "characters", label: "角色", assets: ["characters"] },
  { id: "outline", label: "大纲", assets: ["outline"] },
  { id: "foreshadowing", label: "伏笔", assets: ["foreshadowing"] },
] as const;

function buildAssetAuditRequest(label: string): string {
  return [
    `主动审查全书资产。范围：${label}。`,
    "必须读取已有相关资产，不要只审查当前章节。",
    "检查重复、缺漏、冲突、OOC、时间线错误、伏笔未闭环、设定和正文不一致、工具写入失败或未落库等问题。",
    "能通过低风险资料修正解决的，按当前执行模式走完整工作流修复；涉及高风险或不确定改动先说明并等待确认。",
  ].join("\n");
}
let streamSeq = 0;

export function ConversationPane(props: ConversationPaneProps) {
  const endpoint = props.endpoint ?? ((id: string) => `/api/books/${encodeURIComponent(id)}/agent/run`);
  const streamFn = props.streamFn ?? startSseStream;
  const {
    messages,
    streaming,
    error,
    executionMode,
    pendingConfirmation,
    appendUserMessage,
    appendSystemMessage,
    beginStream,
    appendDelta,
    startWorkflow,
    updateWorkflowStage,
    finishStream,
    setError,
    clearError,
    triggerChapterRefresh,
    triggerLibraryRefresh,
    setPendingConfirmation,
    upsertExecutionStep,
    setAcceptanceReport,
    hydrate,
    reset,
  } = useConversationStore();
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [onboardComplete, setOnboardComplete] = useState<boolean | null>(null);
  const mutatingRunRef = useRef(false);
  const hasVisibleReplyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    reset();
    void (async () => {
      try {
        const [histRes, statusRes] = await Promise.all([
          fetch(`/api/books/${encodeURIComponent(props.bookId)}/conversation?limit=100`),
          fetch(`/api/books/${encodeURIComponent(props.bookId)}/onboard-status`),
        ]);
        if (cancelled) return;
        if (histRes.ok) {
          const j = await histRes.json() as {
            messages: Array<{ id: number; role: "user" | "assistant" | "system"; content: string }>;
          };
          const msgs: ChatMessage[] = j.messages
            .filter(m => m.role === "user" || m.role === "assistant")
            .map(m => ({ id: `hist-${m.id}`, role: m.role, content: m.content }));
          hydrate(msgs);
        }
        if (statusRes.ok) {
          const s = await statusRes.json() as { ok: boolean };
          setOnboardComplete(s.ok);
        }
      } catch {
        // History/status are advisory for the pane.
      }
    })();
    return () => { cancelled = true; };
  }, [props.bookId, hydrate, reset]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.workflowStages.length]);

  useEffect(() => () => handleRef.current?.cancel(), []);

  const markPhase = useCallback((phase: string) => {
    const id = `phase-${phase}`;
    const label = PHASE_LABELS[phase] ?? phase;
    const current = useConversationStore.getState().streaming?.workflowStages ?? [];
    const next = current.map(stage => stage.status === "active" ? { ...stage, status: "done" as const } : stage);
    const existing = next.findIndex(stage => stage.id === id);
    if (existing >= 0) {
      startWorkflow(next.map(stage => stage.id === id ? { ...stage, label, status: "active" as const } : stage));
    } else {
      startWorkflow([...next, { id, label, status: "active" }]);
    }
  }, [startWorkflow]);

  const send = useCallback((text: string, options: SendOptions = {}) => {
    const content = text.trim();
    if (!content || streaming) return;
    clearError();
    setLastSent(content);
    if (options.appendUser !== false) appendUserMessage(options.displayContent ?? content);
    mutatingRunRef.current = false;
    hasVisibleReplyRef.current = false;

    const url = endpoint(props.bookId);
    const body = {
      message: content,
      source: options.source ?? "chat",
      executionMode: options.executionModeOverride ?? executionMode,
      ...(options.target ? { target: options.target } : {}),
    };

    beginStream(`s${++streamSeq}`);
    handleRef.current = streamFn({
      url,
      body,
      onEvent: (ev) => {
        switch (ev.type) {
          case "agent_phase":
            markPhase(String(ev.phase ?? ""));
            break;
          case "main_output": {
            const reply = String(ev.reply ?? "");
            if (reply) {
              hasVisibleReplyRef.current = true;
              appendDelta(reply);
            }
            break;
          }
          case "agent_progress": {
            const id = `${String(ev.phase ?? "unknown")}-${String(ev.label ?? "progress")}`;
            const rawStatus = String(ev.status ?? "pending");
            if (ev.phase === "executing" && rawStatus === "running") mutatingRunRef.current = true;
            const existing = useConversationStore.getState().streaming?.workflowStages ?? [];
            startWorkflow([
              ...existing.filter(stage => stage.id !== id),
              {
                id,
                label: [ev.label, ev.detail].filter(Boolean).join(": "),
                status: rawStatus === "running" ? "active" : rawStatus === "done" ? "done" : rawStatus === "error" ? "error" : "pending",
              },
            ]);
            break;
          }
          case "validation_report":
            setAcceptanceReport({
              taskId: "agent-run",
              verdict: String(ev.verdict ?? "fail") as never,
              userCriteria: [],
              processCriteria: [],
              domainCriteria: [],
              recommendedActions: [],
            });
            break;
          case "repair_plan":
            appendSystemMessage(String(ev.summary ?? "正在修复验收发现的问题"));
            break;
          case "done":
            finishStream();
            handleRef.current = null;
            if (ev.committed === true) {
              appendSystemMessage("变更已提交。");
              triggerChapterRefresh();
              triggerLibraryRefresh();
            } else if (ev.needsUserDecision === true) {
              appendSystemMessage("流程已暂停，等待确认或修复。");
              setPendingConfirmation({
                taskId: String(ev.runId ?? "agent-run"),
                message: "流程已暂停，等待确认或修复。",
                policy: buildDoneDecisionPolicy(executionMode),
              });
            }
            break;
          case "error":
            setError(String(ev.message ?? t.errors.unknown), String(ev.errorClass ?? "unknown"));
            handleRef.current = null;
            break;
          case "usage":
            break;
          default:
            break;
        }
      },
    });
  }, [
    props.bookId,
    endpoint,
    streamFn,
    streaming,
    executionMode,
    appendUserMessage,
    appendSystemMessage,
    beginStream,
    appendDelta,
    markPhase,
    startWorkflow,
    finishStream,
    setError,
    clearError,
    triggerChapterRefresh,
    triggerLibraryRefresh,
    setPendingConfirmation,
    setAcceptanceReport,
  ]);

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    finishStream();
  }, [finishStream]);

  const approveRun = useCallback(async (runId: string) => {
    clearError();
    const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/agent/runs/${encodeURIComponent(runId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setError(body.error ?? "确认提交失败", "commit_failed");
      return;
    }
    appendSystemMessage("变更已提交。");
    triggerChapterRefresh();
    triggerLibraryRefresh();
  }, [props.bookId, appendSystemMessage, clearError, setError, triggerChapterRefresh, triggerLibraryRefresh]);

  const cancelRun = useCallback(async (runId: string) => {
    await fetch(`/api/books/${encodeURIComponent(props.bookId)}/agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(() => undefined);
  }, [props.bookId]);

  const retry = useCallback(() => {
    clearError();
    if (lastSent) send(lastSent);
  }, [lastSent, send, clearError]);

  return (
    <div data-testid="conversation-pane" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {messages.length === 0 && !streaming && onboardComplete === false && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
            <div style={{ fontSize: 48 }}>📘</div>
            <p className="muted" style={{ textAlign: "center", maxWidth: 280, lineHeight: 1.8 }}>
              这是一本新书，还没有完整设定。可以先让 AI 帮您搭建基础资料。
            </p>
            <button
              className="ios-btn-primary"
              data-testid="btn-start-onboard"
              style={{ fontSize: 16, padding: "10px 32px" }}
              onClick={() => send("你好，我想开始写一本新书，请帮我搭建设定。", { appendUser: false, source: "onboard" })}
            >
              开始创建
            </button>
          </div>
        )}
        {messages.length === 0 && !streaming && onboardComplete === true && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <div style={{ fontSize: 40 }}>✓</div>
            <p className="muted" style={{ textAlign: "center", maxWidth: 280, lineHeight: 1.8 }}>
              设定已就绪。可以在下方继续和 AI 对话。
            </p>
          </div>
        )}
        {messages.map(m => <Message key={m.id} m={m} />)}
        {streaming && <StreamingMessage state={streaming} />}
      </div>
      {error && (
        <div
          role="alert"
          data-testid="conversation-error"
          style={{
            margin: "0 12px 8px",
            padding: "8px 12px",
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#c00" }}>{error.message}</span>
          <button data-testid="btn-retry" onClick={retry}>{t.common.retry}</button>
        </div>
      )}
      {pendingConfirmation && (
        <ExecutionConfirmationCard
          taskId={pendingConfirmation.taskId}
          message={pendingConfirmation.message}
          policy={pendingConfirmation.policy}
          onApprove={() => {
            const runId = pendingConfirmation.taskId;
            setPendingConfirmation(null);
            void approveRun(runId);
          }}
          onReroll={() => {
            const runId = pendingConfirmation.taskId;
            setPendingConfirmation(null);
            void cancelRun(runId);
            if (lastSent) send(lastSent, { appendUser: false });
          }}
          onCancel={() => {
            const runId = pendingConfirmation.taskId;
            setPendingConfirmation(null);
            void cancelRun(runId);
          }}
        />
      )}
      <Composer onSend={send} onCancel={cancel} streaming={!!streaming} />
    </div>
  );
}

function buildDoneDecisionPolicy(configuredMode: ExecutionMode): ExecutionPolicy {
  return {
    taskId: "agent-run",
    configuredMode,
    effectiveMode: "confirm",
    highestRisk: "write",
    requiresConfirmation: true,
    reason: "workflow returned needsUserDecision",
    userChoices: ["approve", "edit_plan", "reroll", "cancel"],
  };
}

function Composer(props: { onSend: (text: string, options?: SendOptions) => void; onCancel: () => void; streaming: boolean }) {
  const [value, setValue] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const submit = () => {
    if (!value.trim()) return;
    props.onSend(value);
    setValue("");
    setSlashOpen(false);
  };

  const pickSlash = (alias: string) => {
    const rest = value.includes(" ") ? value.slice(value.indexOf(" ")) : "";
    setValue(alias + (rest || " "));
    setSlashOpen(false);
  };

  const runAssetAudit = (option: typeof ASSET_AUDIT_OPTIONS[number]) => {
    setAuditOpen(false);
    props.onSend(buildAssetAuditRequest(option.label), {
      source: "asset_audit",
      displayContent: `已触发主动审查：${option.label}`,
      target: { auditScope: { assets: option.assets, mode: "report_and_fix" } },
    });
  };

  return (
    <div style={{ borderTop: "1px solid #e5e5e5", padding: 12, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="ios-btn-small"
            data-testid="btn-asset-audit"
            disabled={props.streaming}
            onClick={() => setAuditOpen(v => !v)}
          >
            主动审查
          </button>
          {auditOpen && (
            <div
              data-testid="asset-audit-menu"
              style={{
                position: "absolute",
                left: 0,
                bottom: "calc(100% + 6px)",
                zIndex: 20,
                minWidth: 180,
                padding: 6,
                border: "1px solid #d8d8df",
                borderRadius: 8,
                background: "#fff",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                display: "grid",
                gap: 4,
              }}
            >
              {ASSET_AUDIT_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`asset-audit-option-${option.id}`}
                  onClick={() => runAssetAudit(option)}
                  style={{
                    border: 0,
                    background: "transparent",
                    textAlign: "left",
                    padding: "7px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ExecutionModeSelector />
      </div>
      <SlashSuggestions input={value} visible={slashOpen} onPick={pickSlash} onClose={() => setSlashOpen(false)} />
      <textarea
        data-testid="composer-input"
        value={value}
        placeholder={t.conversation.placeholder}
        rows={3}
        style={{ width: "100%", resize: "vertical", padding: 8, borderRadius: 6, border: "1px solid #d0d0d0" }}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          setSlashOpen(v.startsWith("/") && !v.includes("\n"));
        }}
        onKeyDown={(e) => {
          if (slashOpen && ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(e.key)) {
            if (e.key === "Enter" || e.key === "Tab") e.preventDefault();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && props.streaming) {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "#999" }}>{t.conversation.slashHint}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {props.streaming && (
            <button data-testid="btn-cancel-stream" onClick={props.onCancel}>
              {t.conversation.cancelStream}
            </button>
          )}
          <button className="ios-btn-primary" data-testid="btn-send" onClick={submit} disabled={props.streaming || !value.trim()}>
            {t.conversation.sendButton}
          </button>
        </div>
      </div>
    </div>
  );
}


