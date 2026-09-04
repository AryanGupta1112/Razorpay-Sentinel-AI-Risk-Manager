"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Activity, Send } from "lucide-react";
import { type ConsoleData } from "@/lib/console-adapters";
import { type OperationsMode } from "@/lib/use-operations-control";
import {
  PORTRAIT_H,
  PORTRAIT_W,
  SCENE_H,
  SCENE_W,
  paintPortrait,
  sceneFrameBufs,
} from "@/lib/sentinel-pixel-art/agent-art";
import type { AgentCharacter } from "@/lib/sentinel-pixel-art/agent-art";

const UI_EASE_OUT = [0.23, 1, 0.32, 1] as const;
const CONTROL_ROOM_UI_STORAGE_KEY = "sentinel.control-room-ui.v1";

type ControlRoomTab =
  | "terminal"
  | "monitor"
  | "messages"
  | "triggers"
  | "activity"
  | "decisions";

type ChatDiscussion = ConsoleData["simulator"]["deliberations"][number];
type DirectAgentMessage = {
  id: string;
  agentId: string;
  text: string;
  time: string;
  author: "you" | "agent" | "system";
};

function isControlRoomTab(value: unknown): value is ControlRoomTab {
  return ["terminal", "monitor", "messages", "triggers", "activity", "decisions"].includes(String(value));
}

const MEETING_SEATS = [
  { left: "37%", top: "34%", facing: "front", character: "signal-scout" },
  { left: "59%", top: "34%", facing: "front", character: "merchant-guard" },
  { left: "43%", top: "68%", facing: "back", character: "policy-guard" },
  { left: "65%", top: "68%", facing: "back", character: "queue-ops" },
] as const satisfies ReadonlyArray<{
  left: string;
  top: string;
  facing: "front" | "back";
  character: AgentCharacter;
}>;

function archiveDiscussion(history: ChatDiscussion[], discussion: ChatDiscussion, messageCount: number) {
  const archived = { ...discussion, messages: discussion.messages.slice(0, messageCount) };
  return [...history.filter((entry) => entry.id !== discussion.id), archived].slice(-24);
}

function SeatedAgentSprite({
  character,
  facing,
}: {
  character: AgentCharacter;
  facing: "front" | "back";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const seatedHeight = SCENE_H - 5;
    const frame = sceneFrameBufs(character)[facing][0];
    const image = context.createImageData(SCENE_W, seatedHeight);
    image.data.set(frame.slice(0, SCENE_W * seatedHeight * 4));
    context.clearRect(0, 0, SCENE_W, seatedHeight);
    context.putImageData(image, 0, 0);
  }, [character, facing]);

  return (
    <canvas
      ref={canvasRef}
      width={SCENE_W}
      height={SCENE_H - 5}
      className="h-[81px] w-[54px]"
      style={{ imageRendering: "pixelated" }}
      aria-hidden="true"
    />
  );
}

function AgentPortrait({ character }: { character: AgentCharacter }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context) paintPortrait(context, character, 1);
  }, [character]);

  return (
    <canvas
      ref={canvasRef}
      width={PORTRAIT_W}
      height={PORTRAIT_H}
      className="h-full w-auto max-w-full"
      style={{ imageRendering: "pixelated" }}
      aria-hidden="true"
    />
  );
}

function agentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function SentinelControlRoomScreen({
  data,
  onBack,
  onDataReplace,
  canResolveApprovals,
  canManageOperations,
  operationsMode,
  onOperationsModeChange,
}: {
  data: ConsoleData;
  onBack: () => void;
  onDataReplace: (data: ConsoleData) => void;
  canResolveApprovals: boolean;
  canManageOperations: boolean;
  operationsMode: OperationsMode;
  onOperationsModeChange: (mode: OperationsMode) => void;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [tab, setTab] = useState<ControlRoomTab>("terminal");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(data.simulator.agentRoster[0]?.id ?? null);
  const [messageDraft, setMessageDraft] = useState("");
  const [approvalLoading, setApprovalLoading] = useState<{
    approvalId: string;
    status: "approved" | "rejected";
  } | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [messageLog, setMessageLog] = useState<DirectAgentMessage[]>([]);
  const [messageSending, setMessageSending] = useState(false);
  const [chatProgress, setChatProgress] = useState<{ tick: number | null; count: number }>({ tick: null, count: 1 });
  const [chatHistory, setChatHistory] = useState<ChatDiscussion[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [pinnedDeliberation, setPinnedDeliberation] = useState<ConsoleData["simulator"]["deliberations"][number] | null>(null);
  const [uiRestored, setUiRestored] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const directChatEndRef = useRef<HTMLDivElement | null>(null);
  const [followLiveChat, setFollowLiveChat] = useState(true);
  const isHalted = operationsMode === "halted";

  useEffect(() => {
    let cancelled = false;
    let restoredState: {
      frameIndex?: number;
      tab?: string;
      selectedAgentId?: string | null;
      visibleChatMessages?: number;
      chatHistory?: ChatDiscussion[];
      evidenceOpen?: boolean;
      pinnedDeliberation?: ConsoleData["simulator"]["deliberations"][number] | null;
      messageDraft?: string;
      messageLog?: DirectAgentMessage[];
    } | null = null;

    try {
      const saved = window.localStorage.getItem(CONTROL_ROOM_UI_STORAGE_KEY);
      restoredState = saved ? JSON.parse(saved) : null;
    } catch {
      window.localStorage.removeItem(CONTROL_ROOM_UI_STORAGE_KEY);
    }

    queueMicrotask(() => {
      if (cancelled) return;
      if (typeof restoredState?.frameIndex === "number") setFrameIndex(restoredState.frameIndex);
      if (restoredState?.tab === "workers") setTab("decisions");
      else if (isControlRoomTab(restoredState?.tab)) setTab(restoredState.tab);
      if (typeof restoredState?.selectedAgentId !== "undefined") setSelectedAgentId(restoredState.selectedAgentId);
      if (typeof restoredState?.visibleChatMessages === "number") {
        setChatProgress({ tick: null, count: restoredState.visibleChatMessages });
      }
      if (Array.isArray(restoredState?.chatHistory)) setChatHistory(restoredState.chatHistory.slice(-24));
      if (typeof restoredState?.evidenceOpen === "boolean") setEvidenceOpen(restoredState.evidenceOpen);
      if (typeof restoredState?.pinnedDeliberation !== "undefined") setPinnedDeliberation(restoredState.pinnedDeliberation);
      if (typeof restoredState?.messageDraft === "string") setMessageDraft(restoredState.messageDraft);
      if (Array.isArray(restoredState?.messageLog)) setMessageLog(restoredState.messageLog.slice(-120));
      setUiRestored(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!uiRestored) return;
    window.localStorage.setItem(
      CONTROL_ROOM_UI_STORAGE_KEY,
      JSON.stringify({ frameIndex, tab, selectedAgentId, visibleChatMessages: chatProgress.count, chatHistory, evidenceOpen, pinnedDeliberation, messageDraft, messageLog }),
    );
  }, [chatHistory, chatProgress.count, evidenceOpen, frameIndex, messageDraft, messageLog, pinnedDeliberation, selectedAgentId, tab, uiRestored]);

  useEffect(() => {
    if (isHalted || evidenceOpen || !data.simulator.frames.length || data.simulator.frames.length === 1) return;
    const timer = window.setInterval(() => {
      setFrameIndex((value) => value + 1);
      setChatProgress({ tick: null, count: 1 });
    }, 14500);
    return () => window.clearInterval(timer);
  }, [data.simulator.frames.length, evidenceOpen, isHalted]);

  const currentFrame = data.simulator.frames[frameIndex % Math.max(data.simulator.frames.length, 1)];

  const controlRoomAgents = useMemo(() => {
    const actionByName = new Map(currentFrame?.agentActions.map((action) => [action.agentName, action]) ?? []);
    const approvalsByName = new Map<string, number>();

    for (const approval of data.simulator.approvals) {
      approvalsByName.set(approval.agentName, (approvalsByName.get(approval.agentName) ?? 0) + 1);
    }

    return data.simulator.agentRoster.map((agent) => {
      const liveAction = actionByName.get(agent.name);
      const telemetry = data.simulator.telemetry.find((entry) => entry.agentName === agent.name);
      const memoryCount = data.simulator.agentMemories.filter((memory) => memory.agentName === agent.name).length;
      const approvalCount = approvalsByName.get(agent.name) ?? 0;
      const status = isHalted ? "halted" : liveAction ? "working" : approvalCount > 0 ? "awaiting" : "idle";
      const statusTone =
        status === "halted"
          ? "border-[#a84d44] bg-[#e6806e] text-[#251416]"
          : status === "working"
          ? "border-[#d1b14e] bg-[#fff2b9] text-[#1a1410]"
          : status === "awaiting"
            ? "border-[#b8aec4] bg-[#faf3df] text-[#2b2230]"
            : "border-[#cfc5ba] bg-[#fbf7ee] text-[#51455b]";
      const callout = isHalted
        ? "halted"
        : status === "working" ? liveAction?.action ?? "working" : status === "awaiting" ? "awaiting" : "idle";
      const line =
        isHalted
          ? "All agent work is stopped by the command center."
          : liveAction?.reasoning ??
        (status === "awaiting" ? "Waiting for a human sign-off on the next step." : "Watching the next cluster move.");
      const dockLine = isHalted
        ? "Stopped until Continue is selected."
        : liveAction?.action ?? (status === "awaiting" ? "Waiting for human sign-off." : "Watching for the next change.");

      return {
        ...agent,
        telemetry,
        memoryCount,
        approvalCount,
        status,
        statusTone,
        statusLabel: status,
        line,
        dockLine,
        liveAction,
        callout,
      };
    });
  }, [currentFrame, data.simulator.agentMemories, data.simulator.agentRoster, data.simulator.approvals, data.simulator.telemetry, isHalted]);

  const selectedAgent = controlRoomAgents.find((agent) => agent.id === selectedAgentId) ?? controlRoomAgents[0] ?? null;
  const selectedAgentIndex = Math.max(0, controlRoomAgents.findIndex((agent) => agent.id === selectedAgent?.id));
  const selectedAgentCharacter = MEETING_SEATS[selectedAgentIndex % MEETING_SEATS.length].character;
  const liveDeliberation = data.simulator.deliberations.find(
    (deliberation) => deliberation.tick === currentFrame?.tick,
  ) ?? data.simulator.deliberations.at(-1) ?? null;
  const currentDeliberation = pinnedDeliberation ?? liveDeliberation;
  const previousDeliberations = useMemo(() => {
    const discussions = new Map<string, ChatDiscussion>();
    chatHistory.forEach((discussion) => discussions.set(discussion.id, discussion));
    data.simulator.deliberations
      .filter((discussion) => discussion.id !== currentDeliberation?.id)
      .slice(-6)
      .forEach((discussion) => discussions.set(discussion.id, discussion));
    if (currentDeliberation) discussions.delete(currentDeliberation.id);
    return Array.from(discussions.values()).slice(-24);
  }, [chatHistory, currentDeliberation, data.simulator.deliberations]);
  const previousMessageCount = previousDeliberations.reduce(
    (total, discussion) => total + discussion.messages.length,
    0,
  );
  const visibleChatMessages =
    chatProgress.tick === null || chatProgress.tick === currentDeliberation?.tick ? chatProgress.count : 1;
  const visibleConversation = currentDeliberation?.messages.slice(0, visibleChatMessages) ?? [];
  const isAgentTyping = !isHalted && visibleChatMessages < (currentDeliberation?.messages.length ?? 0);
  const selectedAction = currentFrame?.agentActions.find((entry) => entry.agentName === selectedAgent?.name) ?? null;
  const activeCount = controlRoomAgents.filter((agent) => agent.status === "working").length;
  const idleCount = controlRoomAgents.filter((agent) => agent.status === "idle").length;
  const pendingCount = controlRoomAgents.filter((agent) => agent.status === "awaiting").length;
  const selectedAgentMessages = messageLog.filter((message) => message.agentId === selectedAgent?.id);
  const decisions = data.simulator.deliberations.slice().sort((left, right) => {
    const leftPending = left.consensus.status === "pending" ? 1 : 0;
    const rightPending = right.consensus.status === "pending" ? 1 : 0;
    return rightPending - leftPending || right.tick - left.tick;
  });

  useEffect(() => {
    if (!currentDeliberation || isHalted || visibleChatMessages >= currentDeliberation.messages.length) return;
    const timer = window.setTimeout(() => {
      const nextMessageCount = Math.min(visibleChatMessages + 1, currentDeliberation.messages.length);
      setChatProgress((current) => ({
        tick: currentDeliberation.tick,
        count: current.tick === null || current.tick === currentDeliberation.tick ? nextMessageCount : 2,
      }));
      setChatHistory((history) => archiveDiscussion(history, currentDeliberation, nextMessageCount));
    }, 1450);
    return () => window.clearTimeout(timer);
  }, [currentDeliberation, isHalted, visibleChatMessages]);

  useEffect(() => {
    if (followLiveChat) {
      chatEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentDeliberation?.id, followLiveChat, visibleChatMessages]);

  useEffect(() => {
    if (tab === "terminal") {
      directChatEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [messageSending, selectedAgentId, selectedAgentMessages.length, tab]);

  const agentOpeningMessage = selectedAction
    ? `I am working on the current situation: ${selectedAction.action}. Ask me what I found, why it matters, or what I recommend next.`
    : "I am watching the payment flow. Ask me what I see or what needs attention.";

  const queuePlaceholder = selectedAgent
    ? `Ask ${selectedAgent.name} about the current situation...`
    : "Choose an agent, then ask a question.";

  const primaryTabs: Array<{ id: ControlRoomTab; label: string }> = [
    { id: "terminal", label: "terminal" },
    { id: "monitor", label: "monitor" },
    { id: "messages", label: "ask me" },
    { id: "triggers", label: "triggers" },
  ];

  const secondaryTabs: Array<{ id: ControlRoomTab; label: string }> = [
    { id: "activity", label: "activity" },
    { id: "decisions", label: "decisions" },
  ];

  const panelTitle: Record<ControlRoomTab, string> = {
    terminal: `${selectedAgent?.name ?? "Agent"} conversation`,
    monitor: "Live team discussion",
    messages: "Messages",
    triggers: "Automatic alerts",
    activity: "Control room activity",
    decisions: "Team decisions for you",
  };

  const resolveConsensus = useCallback(
    async (discussion: ChatDiscussion, status: "approved" | "rejected") => {
      const approvalId = discussion.consensus.approvalId;
      if (!approvalId || discussion.consensus.status !== "pending") return;
      if (isHalted) {
        setDecisionError("Continue operations before approving or declining a team decision.");
        return;
      }
      if (!canResolveApprovals) {
        setDecisionError("Your role can inspect this team decision but cannot approve or decline it.");
        return;
      }

      setApprovalLoading({ approvalId, status });
      setDecisionError(null);

      try {
        const response = await fetch(`/api/simulator/approvals/${approvalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "The team decision could not be updated.");
        }

        const snapshotResponse = await fetch("/api/console");
        if (!snapshotResponse.ok) {
          throw new Error("The decision was saved, but the control room could not refresh.");
        }
        const payload = (await snapshotResponse.json()) as { data?: ConsoleData };
        if (!payload.data) throw new Error("The refreshed control-room data was missing.");
        onDataReplace(payload.data);
      } catch (error) {
        setDecisionError(error instanceof Error ? error.message : "The team decision could not be updated.");
      } finally {
        setApprovalLoading(null);
      }
    },
    [canResolveApprovals, isHalted, onDataReplace],
  );

  const sendMessage = useCallback(async () => {
    if (isHalted || messageSending || !selectedAgent || !messageDraft.trim()) return;
    const now = new Date();
    const text = messageDraft.trim();
    const conversationHistory = messageLog
      .filter((entry) => entry.agentId === selectedAgent.id && entry.author !== "system")
      .slice(-10)
      .map((entry) => ({
        role: entry.author === "you" ? ("user" as const) : ("assistant" as const),
        content: entry.text,
      }));
    const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

    setMessageLog((current) => [
      ...current,
      {
        id: `you_${Date.now()}`,
        agentId: selectedAgent.id,
        text,
        time,
        author: "you",
      },
    ]);
    setMessageDraft("");
    setMessageSending(true);

    try {
      const response = await fetch("/api/simulator/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          message: text,
          tick: currentFrame?.tick,
          history: conversationHistory,
        }),
      });
      const payload = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error ?? `${selectedAgent.name} could not answer right now.`);
      }
      const replyTime = new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      setMessageLog((current) => [
        ...current,
        {
          id: `agent_${Date.now()}`,
          agentId: selectedAgent.id,
          text: payload.answer ?? "",
          time: replyTime,
          author: "agent" as const,
        },
      ].slice(-120));
    } catch (error) {
      setMessageLog((current) => [
        ...current,
        {
          id: `error_${Date.now()}`,
          agentId: selectedAgent.id,
          text: error instanceof Error ? error.message : `${selectedAgent.name} could not answer right now.`,
          time,
          author: "system" as const,
        },
      ].slice(-120));
    } finally {
      setMessageSending(false);
    }
  }, [currentFrame?.tick, isHalted, messageDraft, messageLog, messageSending, selectedAgent]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: UI_EASE_OUT }}
      className="flex h-full flex-col overflow-hidden bg-[#1f1625]"
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-[#1f1625] p-2 md:p-3">
        <div
          className="mx-auto grid h-full max-h-full min-w-0 w-full max-w-[1900px] grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_124px] overflow-hidden rounded-[10px] border-[3px] border-[#3b2c42] bg-[#f4e8cf] shadow-[0_28px_120px_rgba(0,0,0,0.38)]"
          style={{ fontFamily: '"Press Start 2P Local", var(--font-mono), monospace' }}
        >
          <div className="grid min-h-0 min-w-0 w-full max-w-full grid-cols-[minmax(0,1fr)_clamp(320px,25vw,344px)] overflow-hidden max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(280px,1fr)_420px] max-[760px]:overflow-auto">
            <section className="min-h-0 min-w-0 border-r-[3px] border-[#312337] bg-[#1c1421] p-3 max-[760px]:border-r-0 max-[760px]:border-b-[3px]">
              <div className="relative h-full overflow-hidden border-[4px] border-[#2b1f31] bg-[#1a121f]">
                <div className="absolute inset-[12px] border-[4px] border-[#2d2431] bg-[#f5ead5]" />
                <div
                  className="absolute inset-[24px] overflow-hidden border-[3px] border-[#312534] bg-[#e6dfcd]"
                  style={{
                    backgroundImage: "url('/sentinel-control-room/office-map.png')",
                    backgroundPosition: "34% 6%",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: "310% 310%",
                    imageRendering: "pixelated",
                  }}
                >
                  <div className="absolute left-[18px] top-[18px] z-20 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center border border-[#7d7079] bg-[#fff4de] text-[#25171c]">
                      <Activity className="h-3 w-3" />
                    </span>
                    <span className="border border-[#7d7079] bg-[#fff4de] px-2 py-1 text-[8px] text-[#25171c]">
                      {isHalted ? "meeting halted" : "team meeting"}
                    </span>
                    <span className="border border-[#7d7079] bg-[#fff4de] px-2 py-1 text-[8px] text-[#25171c]">
                      {isHalted ? "0 working" : `${activeCount} working`}
                    </span>
                  </div>

                  {controlRoomAgents.map((agent, index) => {
                    const selected = agent.id === selectedAgent?.id;
                    const seat = MEETING_SEATS[index % MEETING_SEATS.length];

                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          setSelectedAgentId(agent.id);
                          setTab("terminal");
                        }}
                        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#41b8f0]"
                        style={{ left: seat.left, top: seat.top }}
                        aria-label={`${agent.name}, ${agent.status}`}
                      >
                        <div className={`absolute bottom-[calc(100%-10px)] left-1/2 z-20 w-max max-w-[150px] -translate-x-1/2 border px-1.5 py-[2px] text-center text-[7px] leading-3 text-[#20161b] shadow-[1px_1px_0_rgba(0,0,0,0.15)] max-[1000px]:text-[6px] max-[760px]:hidden ${agent.statusTone}`}>
                          {agent.name} / {agent.statusLabel}
                        </div>
                        <div className={`relative overflow-hidden ${selected ? "drop-shadow-[0_0_5px_#41b8f0]" : ""}`}>
                          <motion.div
                            animate={isHalted ? { y: 0 } : { y: [0, -1, 0] }}
                            transition={isHalted ? { duration: 0 } : { duration: 1.5 + index * 0.12, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                          >
                            <SeatedAgentSprite character={seat.character} facing={seat.facing} />
                          </motion.div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f4e8cf] text-[#23161b]">
              <div className="flex items-center justify-between gap-1.5 border-b-[2px] border-[#403042] px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-8 w-8 items-end justify-center overflow-hidden border border-[#6b5a66] bg-[#f4dcb9] px-1 pt-0.5">
                    <AgentPortrait character={selectedAgentCharacter} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[9px] uppercase tracking-[0.06em] text-[#20151b]">Command Center</div>
                    <div className="text-[9px] text-[#726164]">{selectedAgent?.name ?? "Floor lead"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={isHalted} onClick={() => setFrameIndex((value) => value + 1)} className="border border-[#cbb78d] bg-[#fff7e6] px-1 py-1 text-[7px] uppercase text-[#41343c] transition-colors hover:bg-[#f8ecd3] disabled:cursor-not-allowed disabled:opacity-40">
                    auto
                  </button>
                  <button type="button" onClick={() => setTab("terminal")} className="border border-[#cbb78d] bg-[#fff7e6] px-1 py-1 text-[7px] uppercase text-[#41343c] transition-colors hover:bg-[#f8ecd3]">
                    open
                  </button>
                  <button type="button" onClick={onBack} className="border border-[#b96d60] bg-[#de7d68] px-1 py-1 text-[7px] uppercase text-[#1f1516] transition-colors hover:bg-[#d7725d]">
                    close
                  </button>
                </div>
              </div>

              <div className="border-b-[2px] border-[#403042] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.06em] text-[#52444e]">Control</div>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    aria-pressed={!isHalted}
                    disabled={!canManageOperations}
                    onClick={() => onOperationsModeChange("running")}
                    className={`border px-1.5 py-1 text-[9px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${!isHalted ? "border-[#a84d44] bg-[#e6806e] text-[#251416]" : "border-[#b8a37f] bg-[#fff3d2] text-[#4e4034] hover:bg-[#f8e6b9]"}`}
                  >
                    continue
                  </button>
                  <button
                    type="button"
                    aria-pressed={isHalted}
                    disabled={!canManageOperations}
                    onClick={() => onOperationsModeChange("halted")}
                    className={`border px-1.5 py-1 text-[9px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isHalted ? "border-[#a84d44] bg-[#e6806e] text-[#251416]" : "border-[#b8a37f] bg-[#fff3d2] text-[#4e4034] hover:bg-[#f8e6b9]"}`}
                  >
                    halt
                  </button>
                </div>
              </div>

              <div className="border-b-[2px] border-[#403042] px-2 py-1.5">
                <div className="grid grid-cols-3 gap-1">
                  {[...primaryTabs, ...secondaryTabs].map((item) => (
                    <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`whitespace-nowrap border px-1 py-1 text-[7px] uppercase ${tab === item.id ? "border-[#9a7a35] bg-[#f3e0a6] text-[#1f1718]" : "border-[#cdbd9f] bg-[#f8f0de] text-[#65555c]"}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden bg-[#fcf6e9]">
                <div className="flex h-full flex-col">
                  <div className="border-b border-[#d8c8ab] px-2 py-1 text-[8px] text-[#64575f]">{panelTitle[tab]}</div>
                  <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
                    {tab === "terminal" && (
                      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_104px] gap-1.5">
                        <div className="min-h-0 overflow-auto border border-[#d2c0a2] bg-[#fffdf8] p-2 text-[#2d2025]" aria-live="polite" aria-label={`Conversation with ${selectedAgent?.name ?? "selected agent"}`}>
                          <div className="mb-2 flex min-w-0 items-center justify-between gap-2 border-b border-[#e0d1b8] pb-1.5 text-[6px] uppercase text-[#75636b]">
                            <span className="min-w-0 truncate">Talking directly to {selectedAgent?.name ?? "an agent"}</span>
                            <span className="shrink-0">{selectedAgent?.status ?? "idle"}</span>
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="flex max-w-[92%] items-end gap-1.5 self-start">
                              <span className="flex h-7 w-7 shrink-0 items-end justify-center overflow-hidden border border-[#9f8c75] bg-[#f2ddba] px-0.5 pt-0.5">
                                <AgentPortrait character={selectedAgentCharacter} />
                              </span>
                              <div className="min-w-0 border border-[#8aaeb1] bg-[#eef7f3] px-2 py-1.5">
                                <div className="mb-0.5 text-[6px] uppercase text-[#5d4d55]">{selectedAgent?.name ?? "Agent"}</div>
                                <p className="break-words text-[7px] leading-[1.5] [overflow-wrap:anywhere]">{agentOpeningMessage}</p>
                              </div>
                            </div>
                            {selectedAgentMessages.map((message) => (
                              <div key={message.id} className={`flex max-w-[92%] items-end gap-1.5 ${message.author === "you" ? "self-end flex-row-reverse" : "self-start"}`}>
                                {message.author !== "you" && (
                                  <span className="flex h-7 w-7 shrink-0 items-end justify-center overflow-hidden border border-[#9f8c75] bg-[#f2ddba] px-0.5 pt-0.5">
                                    <AgentPortrait character={selectedAgentCharacter} />
                                  </span>
                                )}
                                <div className={`min-w-0 border px-2 py-1.5 ${message.author === "you" ? "border-[#c7a56e] bg-[#fff2d4]" : message.author === "system" ? "border-[#c98c83] bg-[#f4ddd5]" : "border-[#8aaeb1] bg-[#eef7f3]"}`}>
                                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[6px] uppercase text-[#6e5b64]">
                                    <span>{message.author === "you" ? "You" : message.author === "system" ? "Not delivered" : selectedAgent?.name}</span>
                                    <span className="shrink-0 text-[5px] text-[#8c7981]">{message.time}</span>
                                  </div>
                                  <p className="break-words text-[7px] leading-[1.5] [overflow-wrap:anywhere]">{message.text}</p>
                                </div>
                              </div>
                            ))}
                            {messageSending && (
                              <div className="flex items-center gap-1.5 text-[6px] text-[#796872]">
                                <span className="flex h-7 w-7 items-end justify-center overflow-hidden border border-[#b7a58d] bg-[#f5e7ca] px-0.5 pt-0.5"><AgentPortrait character={selectedAgentCharacter} /></span>
                                <span className="border border-[#d4c5ad] bg-[#f8f1e4] px-2 py-1">{selectedAgent?.name} is replying...</span>
                              </div>
                            )}
                            <div ref={directChatEndRef} />
                          </div>
                        </div>
                        <div className="min-h-0 border-t-[2px] border-[#d3c1a6] pt-1.5">
                          <label htmlFor="agent-message" className="text-[7px] uppercase tracking-[0.06em] text-[#4e4249]">Your message</label>
                          <textarea id="agent-message" disabled={isHalted || messageSending} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={isHalted ? "Continue operations before messaging an agent." : queuePlaceholder} className="control-room-input mt-1 h-[47px] w-full resize-none border border-[#d4c1a4] bg-[#fffdf8] px-2 py-1.5 text-[8px] leading-4 text-[#22161d] outline-none focus:border-[#8b7044] disabled:cursor-not-allowed disabled:opacity-55" />
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[6px] leading-3 text-[#806e76]">Enter to send - Shift+Enter for a new line</span>
                            <button type="button" disabled={isHalted || messageSending || !messageDraft.trim()} onClick={() => void sendMessage()} className="inline-flex shrink-0 items-center gap-1.5 border border-[#b89449] bg-[#eed689] px-2 py-1 text-[8px] uppercase text-[#24190f] hover:bg-[#e7cc73] focus:outline-2 focus:outline-offset-1 focus:outline-[#6e5430] disabled:cursor-not-allowed disabled:opacity-45">
                              {messageSending ? "replying" : "send"}
                              <Send className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {tab === "monitor" && (
                      <div className="h-full min-h-0 overflow-hidden border border-[#c5ad84] bg-[#f8efdc] text-[#2d2025]">
                        {currentDeliberation ? (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_48px] border-b-[2px] border-[#77616d] bg-[#f3e3c1]">
                              <div className="min-w-0 px-2 py-1.5">
                                <div className="text-[7px] uppercase tracking-[0.05em] text-[#776670]">
                                  Live incident {frameIndex + 1}
                                </div>
                                <div className="mt-0.5 line-clamp-2 text-[9px] leading-3 text-[#25181c]" title={currentDeliberation.title}>{currentDeliberation.title}</div>
                                <div className="flex flex-wrap gap-x-1.5 text-[7px] leading-3 text-[#716169]">
                                  <span>{currentDeliberation.amount}</span>
                                  <span aria-hidden="true">/</span>
                                  <span>{currentDeliberation.transactionId}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-center justify-center border-l border-[#c5ad84] bg-[#fff5df] text-[#5d4b55]">
                                <span className="text-[11px] leading-none text-[#8b392f]">{currentDeliberation.riskScore}</span>
                                <span className="mt-0.5 text-[6px] uppercase">risk</span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#d2c0a2] bg-[#fffaf0] px-2 py-1 text-[6px] uppercase tracking-[0.05em] text-[#776670]">
                              <span>Team chat</span>
                              {!followLiveChat ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFollowLiveChat(true);
                                    chatEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                                  }}
                                  className="shrink-0 border border-[#9a7a35] bg-[#f3e0a6] px-1.5 py-0.5 text-[6px] uppercase text-[#2d2025]"
                                >
                                  Jump to live
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFollowLiveChat(false);
                                    chatScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                                  }}
                                  className="shrink-0 border border-[#c5ad84] bg-[#fff8e9] px-1.5 py-0.5 text-[6px] uppercase text-[#5b4851]"
                                >
                                  View {previousMessageCount} earlier
                                </button>
                              )}
                            </div>

                            <div
                              ref={chatScrollRef}
                              onScroll={(event) => {
                                const element = event.currentTarget;
                                setFollowLiveChat(element.scrollHeight - element.scrollTop - element.clientHeight < 32);
                              }}
                              className="relative min-h-0 flex-1 overflow-auto bg-[#fffdf8] px-1.5 py-2"
                              aria-live="polite"
                              aria-label="Live agent group chat"
                            >
                              <div className="flex flex-col gap-2">
                              {previousDeliberations.map((discussion) => (
                                <div key={discussion.id} className="flex flex-col gap-2 border-b border-[#d8c8ad] pb-2">
                                  <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border border-[#d8c8ad] bg-[#f6ead1] px-2 py-1 text-[6px] text-[#74626b]">
                                    <span className="min-w-0 truncate">Earlier: {discussion.merchantName}</span>
                                    <span className="shrink-0">{discussion.transactionId}</span>
                                  </div>
                                  {discussion.messages.map((message, index) => {
                                    const agentIndex = discussion.messages.findIndex(
                                      (entry) => entry.agentName === message.agentName,
                                    );
                                    const alignRight = agentIndex === 1 || agentIndex === 3;
                                    const tones = [
                                      "border-[#8aaeb1] bg-[#eef7f3]",
                                      "border-[#c7a56e] bg-[#fff5df]",
                                      "border-[#a895ae] bg-[#f7f0f6]",
                                      "border-[#91a77f] bg-[#f0f6e8]",
                                    ];

                                    return (
                                      <div key={message.id} className={`flex max-w-[92%] items-end gap-1.5 ${alignRight ? "self-end flex-row-reverse" : "self-start"}`}>
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#9f8c75] bg-[#f2ddba] text-[7px] text-[#25181c]" title={message.role}>
                                          {agentInitials(message.agentName)}
                                        </span>
                                        <div className={`min-w-0 border px-2 py-1.5 ${tones[Math.max(agentIndex, index) % tones.length]}`}>
                                          <div className="mb-0.5 flex min-w-0 items-baseline justify-between gap-2">
                                            <span className="truncate text-[6px] uppercase text-[#493840]" title={`${message.agentName} - ${message.role}`}>{message.agentName}</span>
                                            <span className="shrink-0 text-[5px] text-[#85717a]">{message.time}</span>
                                          </div>
                                          <p className="break-words text-[7px] leading-[1.45] text-[#2d2025] [overflow-wrap:anywhere]">{message.text}</p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                              <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border border-[#bfa36f] bg-[#f2dda9] px-2 py-1 text-[6px] text-[#513f47]">
                                <span className="min-w-0 truncate">Now: {currentDeliberation.merchantName}</span>
                                <span className="shrink-0">Live</span>
                              </div>
                              {visibleConversation.map((message, index) => {
                                const tones = [
                                  "border-[#8aaeb1] bg-[#eef7f3]",
                                  "border-[#c7a56e] bg-[#fff5df]",
                                  "border-[#a895ae] bg-[#f7f0f6]",
                                  "border-[#91a77f] bg-[#f0f6e8]",
                                ];
                                const agentIndex = currentDeliberation.messages.findIndex(
                                  (entry) => entry.agentName === message.agentName,
                                );
                                const alignRight = agentIndex === 1 || agentIndex === 3;

                                return (
                                  <motion.div
                                    key={message.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: UI_EASE_OUT }}
                                    className={`flex max-w-[92%] items-end gap-1.5 ${alignRight ? "self-end flex-row-reverse" : "self-start"}`}
                                  >
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#9f8c75] bg-[#f2ddba] text-[7px] text-[#25181c]" title={message.role}>
                                        {agentInitials(message.agentName)}
                                    </span>
                                    <div className={`min-w-0 border px-2 py-1.5 ${tones[Math.max(agentIndex, index) % tones.length]}`}>
                                      <div className="mb-0.5 flex min-w-0 items-baseline justify-between gap-2">
                                        <span className="truncate text-[6px] uppercase text-[#493840]" title={`${message.agentName} - ${message.role}`}>{message.agentName}</span>
                                        <span className="shrink-0 text-[5px] text-[#85717a]">{message.time}</span>
                                      </div>
                                      <p className="break-words text-[7px] leading-[1.45] text-[#2d2025] [overflow-wrap:anywhere]">{message.text}</p>
                                    </div>
                                  </motion.div>
                                );
                              })}
                              {isAgentTyping && (
                                <div className="flex items-center gap-1.5 text-[6px] text-[#796872]">
                                  <span className="flex h-6 w-6 items-center justify-center border border-[#b7a58d] bg-[#f5e7ca]">{agentInitials(currentDeliberation.messages[visibleChatMessages]?.agentName ?? "Team")}</span>
                                  <span className="border border-[#d4c5ad] bg-[#f8f1e4] px-2 py-1">typing<span aria-hidden="true">...</span></span>
                                </div>
                              )}
                              {isHalted && (
                                <div className="self-center border border-[#c98c83] bg-[#f4ddd5] px-2 py-1 text-[6px] uppercase text-[#7b342e]">Chat paused while operations are halted</div>
                              )}
                              <div ref={chatEndRef} />
                              </div>
                            </div>

                            <div className="flex h-[108px] shrink-0 flex-col border-t-[2px] border-[#77616d] bg-[#f3e5c8]">
                              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#cfb991] px-2 py-1 text-[7px] uppercase text-[#5d4b55]">
                                <span>Team decision</span>
                                <span className="border border-[#7f9a72] bg-[#edf5df] px-1.5 py-0.5 text-[#3f5e37]">
                                  {currentDeliberation.consensus.votes}/4 agree / {currentDeliberation.consensus.confidence}
                                </span>
                              </div>
                              <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
                                <div className="text-[8px] leading-3 text-[#21151a]">{currentDeliberation.consensus.action}</div>
                                <details
                                  open={evidenceOpen}
                                  onToggle={(event) => {
                                    const nextOpen = event.currentTarget.open;
                                    setEvidenceOpen(nextOpen);
                                    if (nextOpen && currentDeliberation) setPinnedDeliberation(currentDeliberation);
                                    if (!nextOpen) setPinnedDeliberation(null);
                                  }}
                                  className="mt-0.5 text-[6px] leading-3 text-[#695761]"
                                >
                                  <summary className="cursor-pointer select-none uppercase text-[#806a74] hover:text-[#493a42]">View evidence</summary>
                                  <p className="mt-0.5 break-words border-t border-[#d4c09c] pt-0.5">{currentDeliberation.consensus.rationale}</p>
                                </details>
                              </div>

                              {currentDeliberation.consensus.status === "pending" ? (
                                <div className="grid shrink-0 grid-cols-2 gap-1.5 border-t border-[#cfb991] p-1.5">
                                  <button
                                    type="button"
                                    disabled={approvalLoading !== null || !canResolveApprovals || isHalted}
                                    onClick={() => void resolveConsensus(currentDeliberation, "approved")}
                                    className="border border-[#2f8a6c] bg-[#d7efdf] px-2 py-1.5 text-[7px] uppercase text-[#164f3d] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {approvalLoading?.approvalId === currentDeliberation.consensus.approvalId && approvalLoading.status === "approved" ? "Saving..." : "Approve decision"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={approvalLoading !== null || !canResolveApprovals || isHalted}
                                    onClick={() => void resolveConsensus(currentDeliberation, "rejected")}
                                    className="border border-[#b8675f] bg-[#f0d6cd] px-2 py-1.5 text-[7px] uppercase text-[#6e2723] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {approvalLoading?.approvalId === currentDeliberation.consensus.approvalId && approvalLoading.status === "rejected" ? "Saving..." : "Decline decision"}
                                  </button>
                                </div>
                              ) : (
                                <div className={`m-1.5 mt-0 shrink-0 border px-2 py-1.5 text-[7px] uppercase ${currentDeliberation.consensus.status === "approved" ? "border-[#2f8a6c] bg-[#d7efdf] text-[#164f3d]" : currentDeliberation.consensus.status === "rejected" ? "border-[#b8675f] bg-[#f0d6cd] text-[#6e2723]" : "border-[#bca98b] bg-[#fff7e6] text-[#65555c]"}`}>
                                  {currentDeliberation.consensus.status === "informational" ? "No approval needed" : `Admin ${currentDeliberation.consensus.status}`}
                                </div>
                              )}
                              {decisionError && <p className="shrink-0 px-2 pb-1.5 text-[7px] leading-3 text-[#8d302b]">{decisionError}</p>}
                            </div>
                          </div>
                        ) : (
                          <div className="px-3 py-4 text-[8px] leading-4 text-[#695761]">No live discussion is available for this step.</div>
                        )}
                      </div>
                    )}

                    {tab === "activity" && (
                      <div className="h-full min-h-0 overflow-auto bg-[#f8efd9] px-2 py-2">
                        <div className="sticky top-0 z-10 bg-[#f8efd9] pb-2 text-[8px] uppercase tracking-[0.08em] text-[#66536d]">Activity</div>
                        <div className="space-y-1.5">
                          {data.simulator.activity.slice().reverse().map((entry) => (
                            <div key={entry.id} className="break-words text-[7px] leading-4 text-[#30242a]">
                              <span className={entry.type === "message" ? "text-[#a98bb7]" : entry.type === "decision" ? "text-[#b17a34]" : "text-[#39876c]"}>{entry.type}</span>{" "}
                              <span>{entry.actor}</span>{" -> "}<span>{entry.target}</span>: {entry.message}{" "}
                              <span className="text-[#93828a]">{entry.time}</span>
                            </div>
                          ))}
                          {messageLog.slice().reverse().map((entry) => (
                            <div key={`local_${entry.id}`} className="break-words text-[7px] leading-4 text-[#30242a]">
                              <span className="text-[#a98bb7]">message</span>{" "}
                              <span>{entry.author}</span>{" -> "}<span>{controlRoomAgents.find((agent) => agent.id === entry.agentId)?.name ?? "agent"}</span>: {entry.text}{" "}
                              <span className="text-[#93828a]">{entry.time}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tab === "decisions" && (
                      <div className="h-full min-h-0 overflow-auto bg-[#f8efd9] pr-0.5">
                        <div className="mb-1.5 border border-[#c7b28d] bg-[#f2e0b9] px-2 py-1.5 text-[7px] leading-3 text-[#4f3f46]">
                          Review the team&apos;s shared recommendation, why it matters, and what will happen before you approve or decline it.
                        </div>
                        <div className="space-y-2">
                          {decisions.map((decision) => {
                            const isPending = decision.consensus.status === "pending";
                            const isThisDecisionLoading = approvalLoading?.approvalId === decision.consensus.approvalId;
                            const statusLabel =
                              decision.consensus.status === "informational"
                                ? "No approval needed"
                                : decision.consensus.status === "pending"
                                  ? "Waiting for your decision"
                                  : decision.consensus.status === "approved"
                                    ? "Approved"
                                    : "Declined";
                            const statusTone =
                              decision.consensus.status === "approved"
                                ? "border-[#65947c] bg-[#e2f0df] text-[#315a43]"
                                : decision.consensus.status === "rejected"
                                  ? "border-[#ba7468] bg-[#f3ded5] text-[#71352e]"
                                  : isPending
                                    ? "border-[#ad833c] bg-[#fff0bd] text-[#624719]"
                                    : "border-[#b9aa91] bg-[#f7efdf] text-[#685962]";

                            return (
                              <article key={decision.id} className="border border-[#bda987] bg-[#fffaf0] text-[#2a1d23]">
                                <div className="flex min-w-0 items-start justify-between gap-2 border-b border-[#d7c5a6] bg-[#f5e7cb] px-2 py-1.5">
                                  <div className="min-w-0">
                                    <div role="heading" aria-level={3} className="break-words text-[8px] leading-3 text-[#2a1d23]">{decision.title}</div>
                                    <p className="mt-0.5 break-words text-[6px] leading-3 text-[#706069]">{decision.merchantName} - {decision.transactionId} - {decision.amount}</p>
                                  </div>
                                  <span className={`shrink-0 border px-1 py-0.5 text-[5px] uppercase leading-3 ${statusTone}`}>{statusLabel}</span>
                                </div>
                                <div className="space-y-1.5 px-2 py-1.5">
                                  <div>
                                    <div className="text-[6px] uppercase text-[#7b6871]">What the team recommends</div>
                                    <p className="mt-0.5 break-words text-[7px] leading-[1.55] [overflow-wrap:anywhere]">{decision.consensus.action}</p>
                                  </div>
                                  <div>
                                    <div className="text-[6px] uppercase text-[#7b6871]">Why they agree</div>
                                    <p className="mt-0.5 break-words text-[7px] leading-[1.55] text-[#55464e] [overflow-wrap:anywhere]">{decision.consensus.rationale}</p>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1 text-center text-[6px]">
                                    <span className="border border-[#d5c3a4] bg-[#f8eedb] px-1 py-1">{decision.consensus.votes}/4 agree</span>
                                    <span className="border border-[#d5c3a4] bg-[#f8eedb] px-1 py-1">{decision.consensus.confidence} sure</span>
                                    <span className="border border-[#d5c3a4] bg-[#f8eedb] px-1 py-1">Risk {decision.riskScore}/100</span>
                                  </div>
                                </div>
                                {isPending && decision.consensus.approvalId && (
                                  <div className="grid grid-cols-2 gap-1.5 border-t border-[#d7c5a6] p-1.5">
                                    <button type="button" disabled={approvalLoading !== null || !canResolveApprovals || isHalted} onClick={() => void resolveConsensus(decision, "approved")} className="border border-[#458268] bg-[#dcecdf] px-1.5 py-1.5 text-[6px] uppercase text-[#22513d] hover:bg-[#cce5d2] disabled:cursor-not-allowed disabled:opacity-50">
                                      {isThisDecisionLoading && approvalLoading?.status === "approved" ? "Saving..." : "Approve"}
                                    </button>
                                    <button type="button" disabled={approvalLoading !== null || !canResolveApprovals || isHalted} onClick={() => void resolveConsensus(decision, "rejected")} className="border border-[#ad6257] bg-[#f0d6cd] px-1.5 py-1.5 text-[6px] uppercase text-[#6e2723] hover:bg-[#e9c5bb] disabled:cursor-not-allowed disabled:opacity-50">
                                      {isThisDecisionLoading && approvalLoading?.status === "rejected" ? "Saving..." : "Decline"}
                                    </button>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                          {!decisions.length && (
                            <div className="border border-[#d3c1a5] bg-[#fffdf8] px-2 py-3 text-[8px] leading-4 text-[#63555e]">The agents have not presented a team decision yet.</div>
                          )}
                        </div>
                        {decisionError && <p className="sticky bottom-0 mt-2 border border-[#c98c83] bg-[#f4ddd5] px-2 py-1.5 text-[7px] leading-3 text-[#8d302b]">{decisionError}</p>}
                      </div>
                    )}

                    {(tab === "messages" || tab === "triggers") && (
                      <div className="break-words border border-[#d3c1a5] bg-[#fffdf8] px-2 py-2 text-[9px] leading-4 text-[#63555e]">
                        {tab === "messages" && "Use Terminal to speak directly with the selected agent. Your conversation stays there when live data refreshes."}
                        {tab === "triggers" && "Automatic triggers for new fraud spikes and review pressure appear here."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <div className="border-t-[3px] border-[#33253a] bg-[#f4e8cf]">
            <div className="border-b border-[#d7c7ab] px-3 py-1 text-[9px] uppercase tracking-[0.08em] text-[#665864]">
              {isHalted
                ? `All operations halted - live update ${frameIndex + 1}`
                : `${activeCount} working - ${pendingCount} awaiting - ${idleCount} idle - live update ${frameIndex + 1}`}
            </div>
            <div className="flex h-[100px] gap-2 overflow-x-auto overflow-y-hidden bg-[#f7ecd4] px-2 py-1.5">
              {controlRoomAgents.map((agent, index) => {
                const selected = agent.id === selectedAgent?.id;
                const meterWidth = Math.min(100, Math.max(8, agent.liveAction ? agent.liveAction.confidence : 28));

                return (
                  <button
                    key={`${agent.id}-dock`}
                    type="button"
                    onClick={() => {
                      setSelectedAgentId(agent.id);
                      setTab("terminal");
                    }}
                    className={`relative flex h-full min-w-[276px] max-w-[276px] gap-2 overflow-hidden border p-1.5 text-left ${selected ? "border-[#2aa1bb] bg-[#fff9e8] shadow-[inset_0_0_0_1px_#2aa1bb]" : "border-[#c8b89f] bg-[#fff7e6]"}`}
                  >
                    <div className="flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden border border-[#675760] bg-[#f3debd] px-1 pt-1">
                      <AgentPortrait character={MEETING_SEATS[index % MEETING_SEATS.length].character} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 break-words text-[8px] uppercase leading-3 text-[#1f1318]">{agent.name}</div>
                        <span className={`border px-1 py-0.5 text-[8px] uppercase ${agent.statusTone}`}>{agent.statusLabel}</span>
                      </div>
                      <div className="pt-0.5 text-[8px] leading-3 text-[#65575e]">{agent.role}</div>
                      <div className="pt-0.5 text-[8px] leading-3 text-[#7d6e75]">{agent.dockLine}</div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[7px] uppercase text-[#6c5f66]">
                        <span>{agent.memoryCount} notes</span>
                        <span>{agent.approvalCount} queued</span>
                      </div>
                      <div className="mt-1 h-[4px] overflow-hidden border border-[#d2c1a4] bg-[#ebdfc9]">
                        <div className={`h-full ${agent.status === "halted" ? "bg-[#d96759]" : agent.status === "working" ? "bg-[#49a7c0]" : "bg-[#d7b95c]"}`} style={{ width: `${meterWidth}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
