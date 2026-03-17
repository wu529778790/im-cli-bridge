
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
