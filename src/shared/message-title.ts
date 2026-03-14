import { getAIToolDisplayName, OPEN_IM_BRAND_SUFFIX } from "./utils.js";

export type SharedMessageStatus = "thinking" | "streaming" | "done" | "error";
export const OPEN_IM_SYSTEM_TITLE = "open-im";

const DEFAULT_STATUS_TITLES: Record<SharedMessageStatus, string> = {
  thinking: "思考中",
  streaming: "执行中",
  done: "完成",
  error: "错误",
};

interface BuildMessageTitleOptions {
  brandSuffix?: boolean;
  statusTitles?: Partial<Record<SharedMessageStatus, string>>;
}

export function buildMessageTitle(
  toolId: string,
  status: SharedMessageStatus,
  options: BuildMessageTitleOptions = {},
): string {
  const toolName = getAIToolDisplayName(toolId);
  const statusTitle = options.statusTitles?.[status] ?? DEFAULT_STATUS_TITLES[status];
  const title = status === "done" ? toolName : `${toolName} - ${statusTitle}`;
  return options.brandSuffix ? `${title}${OPEN_IM_BRAND_SUFFIX}` : title;
}
