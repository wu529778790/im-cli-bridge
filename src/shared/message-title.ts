import { getAIToolDisplayName, OPEN_IM_BRAND_SUFFIX } from "./utils.js";

export type SharedMessageStatus = "thinking" | "streaming" | "done" | "error";
export const OPEN_IM_SYSTEM_TITLE = "open-im";

const DEFAULT_STATUS_TITLES: Record<SharedMessageStatus, string> = {
  thinking: "\u601d\u8003\u4e2d",
  streaming: "\u6267\u884c\u4e2d",
  done: "\u5b8c\u6210",
  error: "\u9519\u8bef",
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
  const title = `${toolName} - ${statusTitle}`;
  return options.brandSuffix ? `${title}${OPEN_IM_BRAND_SUFFIX}` : title;
}
