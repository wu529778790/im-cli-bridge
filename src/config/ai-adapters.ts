/**
 * 不同 AI CLI 工具的适配配置
 * 各工具参数不同，在此分别定义
 */

export interface AIAdapter {
  /** 启动时的固定参数（不含 prompt） */
  baseArgs: string[];
  /** 如何传入用户消息：'p' 表示 -p "msg"，'positional' 表示作为最后一个参数 */
  promptStyle: "p" | "positional";
}

const adapters: Record<string, AIAdapter> = {
  claude: {
    baseArgs: ["--dangerously-skip-permissions"],
    promptStyle: "p",
  },
  claudecode: {
    baseArgs: ["--dangerously-skip-permissions"],
    promptStyle: "p",
  },
  codex: {
    // exec 子命令为 CI/脚本设计，无需 TTY，避免 "stdin is not a terminal"
    baseArgs: ["exec", "--dangerously-bypass-approvals-and-sandbox"],
    promptStyle: "positional",
  },
  cc: {
    baseArgs: ["--dangerously-skip-permissions"],
    promptStyle: "p",
  },
  cursor: {
    baseArgs: [],
    promptStyle: "positional",
  },
};

/**
 * 根据 AI_COMMAND 获取命令的 basename（用于查找适配器）
 */
function getCommandKey(command: string): string {
  const base = command.split(/[/\\]/).pop() || command;
  return base.replace(/\.(exe|cmd)$/i, "").toLowerCase();
}

/**
 * 获取指定命令的适配配置，未知命令使用默认（无 baseArgs，-p 风格）
 */
export function getAIAdapter(command: string): AIAdapter {
  const key = getCommandKey(command);
  return adapters[key] ?? { baseArgs: [], promptStyle: "p" };
}

/**
 * 构建 one-shot 调用的完整参数
 */
export function buildOneShotArgs(command: string, message: string): string[] {
  const adapter = getAIAdapter(command);
  if (adapter.promptStyle === "positional") {
    return [...adapter.baseArgs, message];
  }
  return [...adapter.baseArgs, "-p", message];
}
