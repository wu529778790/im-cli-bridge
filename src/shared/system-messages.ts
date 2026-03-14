export function buildPermissionRequestMessage(
  toolName: string,
  toolInput: string,
  requestId: string,
): string {
  const preview = toolInput.length > 300 ? `${toolInput.slice(0, 300)}...` : toolInput;
  return [
    "🔐 权限请求",
    "",
    `工具: ${toolName}`,
    "",
    "参数:",
    "```",
    preview,
    "```",
    "",
    "请回复以下命令：",
    "- /allow",
    "- /deny",
    "",
    `请求 ID: ${requestId.slice(-8)}`,
  ].join("\n");
}

export function buildModeMessage(currentModeLabel: string): string {
  return [
    "🔐 权限模式",
    "",
    `当前模式: ${currentModeLabel}`,
    "",
    "发送以下命令切换：",
    "- /mode ask",
    "- /mode accept-edits",
    "- /mode plan",
    "- /mode yolo",
  ].join("\n");
}

export function buildDirectoryMessage(currentDir: string, directories?: string[]): string {
  if (!directories || directories.length === 0) {
    return [
      `📁 当前目录: ${currentDir}`,
      "",
      "没有可访问的子目录。",
      "",
      "可发送 /cd <路径> 切换目录。",
    ].join("\n");
  }

  return [
    `📁 当前目录: ${currentDir}`,
    "",
    "可用目录:",
    ...directories,
    "",
    "请发送 /cd <路径> 切换目录。",
  ].join("\n");
}
