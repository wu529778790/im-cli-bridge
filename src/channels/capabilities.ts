import type { Platform } from "../config.js";

export type CapabilityLevel = "native" | "fallback" | "none";
export type InboundMessageKind = "text" | "image" | "file" | "voice" | "video";
export type OutboundMessageKind = "streamEdit" | "streamPush" | "image" | "card" | "typing";

export interface ChannelCapabilities {
  inbound: Record<InboundMessageKind, CapabilityLevel>;
  outbound: Record<OutboundMessageKind, CapabilityLevel>;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  telegram: "Telegram",
  feishu: "Feishu",
  qq: "QQ",
  wechat: "微信",
  wework: "企业微信",
  dingtalk: "钉钉",
};

export const CHANNEL_CAPABILITIES: Record<Platform, ChannelCapabilities> = {
  telegram: {
    inbound: { text: "native", image: "native", file: "native", voice: "native", video: "native" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "native", card: "native", typing: "native" },
  },
  feishu: {
    inbound: { text: "native", image: "native", file: "native", voice: "fallback", video: "fallback" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "native", card: "native", typing: "native" },
  },
  qq: {
    inbound: { text: "native", image: "fallback", file: "fallback", voice: "none", video: "none" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "fallback", card: "fallback", typing: "fallback" },
  },
  wechat: {
    inbound: { text: "native", image: "fallback", file: "fallback", voice: "fallback", video: "fallback" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "fallback", card: "native", typing: "native" },
  },
  wework: {
    inbound: { text: "native", image: "fallback", file: "fallback", voice: "fallback", video: "fallback" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "native", card: "native", typing: "native" },
  },
  dingtalk: {
    inbound: { text: "native", image: "fallback", file: "fallback", voice: "fallback", video: "fallback" },
    outbound: { streamEdit: "native", streamPush: "fallback", image: "fallback", card: "native", typing: "native" },
  },
};

function listPreferredPlatforms(kind: Exclude<InboundMessageKind, "text">): string {
  return Object.entries(CHANNEL_CAPABILITIES)
    .filter(([, capabilities]) => capabilities.inbound[kind] === "native")
    .map(([platform]) => PLATFORM_LABELS[platform as Platform])
    .join(" / ");
}

export function buildUnsupportedInboundMessage(
  platform: Platform,
  kind: Exclude<InboundMessageKind, "text">,
): string {
  const platformLabel = PLATFORM_LABELS[platform];
  const preferred = listPreferredPlatforms(kind);
  const kindLabel =
    kind === "image" ? "图片" :
    kind === "file" ? "文件" :
    kind === "voice" ? "语音" :
    "视频";

  if (preferred) {
    return `${platformLabel} 当前还不支持直接处理${kindLabel}消息。可改用 ${preferred}，或先发送文字说明/文件链接后继续。`;
  }

  return `${platformLabel} 当前还不支持直接处理${kindLabel}消息。请先发送文字说明或可访问的文件链接。`;
}

export function buildImageFallbackMessage(platform: Platform, path: string): string {
  return `${PLATFORM_LABELS[platform]} 当前没有原生图片回传，已改为文本提示。图片已保存到: ${path}`;
}
