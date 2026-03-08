/**
 * 命令执行器接口定义
 * 定义了命令执行的核心功能和结果处理
 */

/**
 * 执行选项接口
 */
export interface ExecutionOptions {
  /** 要执行的命令 */
  command: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 环境变量 */
  environment?: Record<string, string>;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 会话ID */
  sessionId?: string;
  /** 输入数据 */
  input?: string;
  /** 是否使用shell */
  useShell?: boolean;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 最大输出大小(字节) */
  maxOutputSize?: number;
  /** 编码 */
  encoding?: BufferEncoding;
}

/**
 * 执行结果接口
 */
export interface ExecutionResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出代码 */
  exitCode: number;
  /** 执行时长(毫秒) */
  duration: number;
  /** 是否超时 */
  timedOut?: boolean;
  /** 执行的命令 */
  command: string;
  /** 工作目录 */
  workingDirectory?: string;
  /** 时间戳 */
  timestamp: number;
  /** 会话ID */
  sessionId?: string;
}

/**
 * 工具使用信息接口
 */
export interface ToolUseInfo {
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  parameters: Record<string, any>;
  /** 工具ID */
  id?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 进度信息接口
 */
export interface ProgressInfo {
  /** 当前阶段 */
  stage: string;
  /** 进度百分比(0-100) */
  percentage: number;
  /** 当前状态消息 */
  message?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 流式回调接口
 */
export interface StreamCallbacks {
  /** 数据回调 */
  onData?: (data: string, stream: 'stdout' | 'stderr') => void | Promise<void>;
  /** 错误回调 */
  onError?: (error: Error) => void | Promise<void>;
  /** 工具使用回调 */
  onToolUse?: (tool: ToolUseInfo) => void | Promise<void>;
  /** 进度回调 */
  onProgress?: (progress: ProgressInfo) => void | Promise<void>;
  /** 完成回调 */
  onComplete?: (result: ExecutionResult) => void | Promise<void>;
  /** 开始回调 */
  onStart?: (command: string) => void | Promise<void>;
}

/**
 * 验证结果接口
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误消息 */
  error?: string;
  /** 警告消息 */
  warnings?: string[];
  /** 建议的修正 */
  suggestions?: string[];
}

/**
 * 命令信息接口
 */
export interface CommandInfo {
  /** 命令字符串 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 命令名称 */
  name: string;
  /** 命令路径 */
  path?: string;
  /** 是否为内置命令 */
  builtin?: boolean;
}

/**
 * 执行上下文接口
 */
export interface ExecutionContext {
  /** 会话ID */
  sessionId: string;
  /** 用户ID */
  userId: string;
  /** 工作目录 */
  workingDirectory: string;
  /** 环境变量 */
  environment: Record<string, string>;
  /** 执行历史 */
  history: ExecutionResult[];
  /** 自定义数据 */
  custom?: Record<string, any>;
}

/**
 * 命令执行器接口
 */
export interface CommandExecutor {
  /**
   * 执行命令
   * @param options 执行选项
   * @param context 执行上下文
   * @returns 执行结果
   */
  execute(options: ExecutionOptions, context?: ExecutionContext): Promise<ExecutionResult>;

  /**
   * 流式执行命令
   * @param options 执行选项
   * @param callbacks 流式回调
   * @param context 执行上下文
   * @returns 执行结果
   */
  executeStream(
    options: ExecutionOptions,
    callbacks: StreamCallbacks,
    context?: ExecutionContext
  ): Promise<ExecutionResult>;

  /**
   * 验证命令
   * @param command 命令字符串
   * @returns 验证结果
   */
  validate(command: string): Promise<ValidationResult>;

  /**
   * 解析命令
   * @param commandString 命令字符串
   * @returns 命令信息
   */
  parseCommand(commandString: string): CommandInfo;

  /**
   * 取消正在执行的命令
   * @param sessionId 会话ID
   */
  cancel(sessionId: string): Promise<void>;

  /**
   * 获取执行历史
   * @param sessionId 会话ID
   * @param limit 返回数量限制
   * @returns 执行历史
   */
  getHistory(sessionId: string, limit?: number): ExecutionResult[];

  /**
   * 清除执行历史
   * @param sessionId 会话ID
   */
  clearHistory(sessionId: string): Promise<void>;
}
