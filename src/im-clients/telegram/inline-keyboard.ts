/**
 * Telegram内联键盘构建器
 * 用于构建交互式按钮和处理回调查询
 * 支持多行按钮、URL按钮、回调按钮等
 */

import { logger } from '../../utils/logger';

/**
 * 按钮类型
 */
export enum ButtonType {
  /** 回调按钮 */
  CALLBACK = 'callback',
  /** URL按钮 */
  URL = 'url',
  /** 切换内联按钮 */
  SWITCH_INLINE_QUERY = 'switch_inline_query',
  /** 切换当前内联按钮 */
  SWITCH_INLINE_QUERY_CURRENT_CHAT = 'switch_inline_query_current_chat',
  /** 描述性按钮(不可点击) */
  DESCRIPTION = 'description',
}

/**
 * 按钮配置接口
 */
export interface ButtonConfig {
  /** 按钮文本 */
  text: string;
  /** 按钮类型 */
  type?: ButtonType;
  /** 回调数据(仅用于CALLBACK类型) */
  callbackData?: string;
  /** URL(仅用于URL类型) */
  url?: string;
  /** 内联查询(仅用于SWITCH_INLINE_QUERY类型) */
  inlineQuery?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 按钮样式 */
  style?: 'default' | 'primary' | 'danger' | 'success';
}

/**
 * 键盘行配置
 */
export type KeyboardRow = ButtonConfig[];

/**
 * 键盘布局配置
 */
export type KeyboardLayout = KeyboardRow[];

/**
 * 内联键盘构建器类
 */
export class InlineKeyboardBuilder {
  private keyboard: KeyboardLayout = [];

  /**
   * 添加按钮到当前行
   */
  addButton(button: ButtonConfig): this {
    if (this.keyboard.length === 0) {
      this.addRow();
    }

    const currentRow = this.keyboard[this.keyboard.length - 1];
    currentRow.push(button);

    return this;
  }

  /**
   * 添加多个按钮到当前行
   */
  addButtons(buttons: ButtonConfig[]): this {
    buttons.forEach((button) => this.addButton(button));
    return this;
  }

  /**
   * 添加新行
   */
  addRow(buttons?: ButtonConfig[]): this {
    this.keyboard.push(buttons || []);
    return this;
  }

  /**
   * 添加回调按钮
   */
  addCallbackButton(text: string, callbackData: string, style?: 'default' | 'primary' | 'danger' | 'success'): this {
    return this.addButton({
      text,
      type: ButtonType.CALLBACK,
      callbackData,
      style,
    });
  }

  /**
   * 添加URL按钮
   */
  addUrlButton(text: string, url: string): this {
    return this.addButton({
      text,
      type: ButtonType.URL,
      url,
    });
  }

  /**
   * 添加切换内联查询按钮
   */
  addSwitchInlineButton(text: string, query: string = ''): this {
    return this.addButton({
      text,
      type: ButtonType.SWITCH_INLINE_QUERY,
      inlineQuery: query,
    });
  }

  /**
   * 添加切换当前内联查询按钮
   */
  addSwitchInlineCurrentButton(text: string, query: string = ''): this {
    return this.addButton({
      text,
      type: ButtonType.SWITCH_INLINE_QUERY_CURRENT_CHAT,
      inlineQuery: query,
    });
  }

  /**
   * 添加一行回调按钮
   */
  addCallbackRow(buttons: Array<{ text: string; data: string }>): this {
    const row = buttons.map((btn) => ({
      text: btn.text,
      type: ButtonType.CALLBACK,
      callbackData: btn.data,
    }));

    return this.addRow(row);
  }

  /**
   * 添加一行URL按钮
   */
  addUrlRow(buttons: Array<{ text: string; url: string }>): this {
    const row = buttons.map((btn) => ({
      text: btn.text,
      type: ButtonType.URL,
      url: btn.url,
    }));

    return this.addRow(row);
  }

  /**
   * 添加确认/取消按钮
   */
  addConfirmCancel(confirmText: string = '✅ 确认', cancelText: string = '❌ 取消'): this {
    return this.addRow([
      { text: confirmText, type: ButtonType.CALLBACK, callbackData: 'confirm' },
      { text: cancelText, type: ButtonType.CALLBACK, callbackData: 'cancel' },
    ]);
  }

  /**
   * 添加是/否按钮
   */
  addYesNo(yesText: string = '是', noText: string = '否'): this {
    return this.addRow([
      { text: yesText, type: ButtonType.CALLBACK, callbackData: 'yes' },
      { text: noText, type: ButtonType.CALLBACK, callbackData: 'no' },
    ]);
  }

  /**
   * 添加数字键盘(1-9)
   */
  addNumberPad(): this {
    for (let i = 1; i <= 9; i += 3) {
      this.addRow();
      for (let j = 0; j < 3 && i + j <= 9; j++) {
        this.addCallbackButton((i + j).toString(), `num_${i + j}`);
      }
    }

    // 最后一行: * 0 #
    this.addRow([
      { text: '*', type: ButtonType.CALLBACK, callbackData: 'num_*' },
      { text: '0', type: ButtonType.CALLBACK, callbackData: 'num_0' },
      { text: '#', type: ButtonType.CALLBACK, callbackData: 'num_#' },
    ]);

    return this;
  }

  /**
   * 添加分页按钮
   */
  addPagination(currentPage: number, totalPages: number, prefix: string = 'page'): this {
    const row: ButtonConfig[] = [];

    // 上一页按钮
    if (currentPage > 1) {
      row.push({
        text: '⬅️ 上一页',
        type: ButtonType.CALLBACK,
        callbackData: `${prefix}_${currentPage - 1}`,
      });
    }

    // 页码显示
    row.push({
      text: `${currentPage}/${totalPages}`,
      type: ButtonType.DESCRIPTION,
    });

    // 下一页按钮
    if (currentPage < totalPages) {
      row.push({
        text: '下一页 ➡️',
        type: ButtonType.CALLBACK,
        callbackData: `${prefix}_${currentPage + 1}`,
      });
    }

    return this.addRow(row);
  }

  /**
   * 添加菜单按钮
   */
  addMenu(menuItems: Array<{ label: string; action: string }>, columns: number = 2): this {
    for (let i = 0; i < menuItems.length; i += columns) {
      const row = menuItems
        .slice(i, i + columns)
        .map((item) => ({
          text: item.label,
          type: ButtonType.CALLBACK,
          callbackData: item.action,
        }));

      this.addRow(row);
    }

    return this;
  }

  /**
   * 添加设置按钮
   */
  addSettings(settings: Array<{ label: string; key: string; value?: string }>): this {
    settings.forEach((setting) => {
      const text = setting.value ? `${setting.label}: ${setting.value}` : setting.label;
      this.addCallbackButton(text, `setting_${setting.key}`);
    });

    return this;
  }

  /**
   * 构建键盘
   */
  build(): any {
    return this.convertToTelegramFormat(this.keyboard);
  }

  /**
   * 重置键盘
   */
  reset(): this {
    this.keyboard = [];
    return this;
  }

  /**
   * 获取键盘布局
   */
  getLayout(): KeyboardLayout {
    return JSON.parse(JSON.stringify(this.keyboard));
  }

  /**
   * 从布局创建键盘
   */
  fromLayout(layout: KeyboardLayout): this {
    this.keyboard = JSON.parse(JSON.stringify(layout));
    return this;
  }

  /**
   * 转换为Telegram格式
   */
  private convertToTelegramFormat(layout: KeyboardLayout): any {
    return {
      inline_keyboard: layout.map((row) =>
        row
          .filter((btn) => btn.type !== ButtonType.DESCRIPTION)
          .map((btn) => {
            const button: any = {
              text: btn.text,
            };

            switch (btn.type) {
              case ButtonType.CALLBACK:
                button.callback_data = btn.callbackData || btn.text;
                break;
              case ButtonType.URL:
                button.url = btn.url;
                break;
              case ButtonType.SWITCH_INLINE_QUERY:
                button.switch_inline_query = btn.inlineQuery || '';
                break;
              case ButtonType.SWITCH_INLINE_QUERY_CURRENT_CHAT:
                button.switch_inline_query_current_chat = btn.inlineQuery || '';
                break;
            }

            return button;
          })
      ),
    };
  }

  /**
   * 解析回调数据
   */
  static parseCallbackData(callbackData: string): { action: string; params?: string[] } {
    const parts = callbackData.split('_');
    return {
      action: parts[0],
      params: parts.slice(1),
    };
  }

  /**
   * 创建回调数据
   */
  static createCallbackData(action: string, ...params: string[]): string {
    return [action, ...params].join('_');
  }

  /**
   * 验证回调数据
   */
  static validateCallbackData(callbackData: string, pattern: RegExp): boolean {
    return pattern.test(callbackData);
  }
}

/**
 * 回调查询处理器类
 */
export class CallbackQueryHandler {
  private handlers: Map<string, (data: any) => Promise<void>> = new Map();

  /**
   * 注册回调处理器
   */
  register(pattern: string | RegExp, handler: (data: any) => Promise<void>): void {
    const key = pattern instanceof RegExp ? pattern.source : pattern;
    this.handlers.set(key, handler);
    logger.debug(`Registered callback handler for pattern: ${key}`);
  }

  /**
   * 处理回调查询
   */
  async handle(callbackData: string, queryData: any): Promise<boolean> {
    for (const [pattern, handler] of this.handlers) {
      try {
        const regex = new RegExp(`^${pattern}$`);
        if (regex.test(callbackData)) {
          await handler({ ...queryData, callbackData });
          return true;
        }
      } catch (error) {
        logger.error(`Error in callback handler for pattern ${pattern}:`, error);
      }
    }

    logger.warn(`No handler found for callback data: ${callbackData}`);
    return false;
  }

  /**
   * 移除回调处理器
   */
  unregister(pattern: string | RegExp): void {
    const key = pattern instanceof RegExp ? pattern.source : pattern;
    this.handlers.delete(key);
    logger.debug(`Unregistered callback handler for pattern: ${key}`);
  }

  /**
   * 清除所有处理器
   */
  clear(): void {
    this.handlers.clear();
    logger.debug('Cleared all callback handlers');
  }
}

/**
 * 预定义的键盘模板
 */
export class KeyboardTemplates {
  /**
   * 确认/取消键盘
   */
  static confirmCancel(customConfirm?: string, customCancel?: string): any {
    return new InlineKeyboardBuilder()
      .addConfirmCancel(customConfirm, customCancel)
      .build();
  }

  /**
   * 是/否键盘
   */
  static yesNo(customYes?: string, customNo?: string): any {
    return new InlineKeyboardBuilder().addYesNo(customYes, customNo).build();
  }

  /**
   * 主菜单键盘
   */
  static mainMenu(): any {
    return new InlineKeyboardBuilder()
      .addMenu(
        [
          { label: '📝 命令', action: 'menu_command' },
          { label: '⚙️ 设置', action: 'menu_settings' },
          { label: '📊 状态', action: 'menu_status' },
          { label: '❓ 帮助', action: 'menu_help' },
        ],
        2
      )
      .build();
  }

  /**
   * 命令菜单键盘
   */
  static commandMenu(): any {
    return new InlineKeyboardBuilder()
      .addMenu(
        [
          { label: '/new', action: 'cmd_new' },
          { label: '/clear', action: 'cmd_clear' },
          { label: '/status', action: 'cmd_status' },
          { label: '/model', action: 'cmd_model' },
          { label: '/resume', action: 'cmd_resume' },
          { label: '🔙 返回', action: 'menu_back' },
        ],
        2
      )
      .build();
  }

  /**
   * 模型选择键盘
   */
  static modelSelection(models: string[]): any {
    return new InlineKeyboardBuilder()
      .addMenu(
        models.map((model) => ({
          label: model,
          action: `model_${model}`,
        })),
        1
      )
      .addRow([
        { text: '🔙 返回', type: ButtonType.CALLBACK, callbackData: 'menu_back' },
      ])
      .build();
  }

  /**
   * 分页键盘
   */
  static pagination(currentPage: number, totalPages: number, prefix: string = 'page'): any {
    return new InlineKeyboardBuilder()
      .addPagination(currentPage, totalPages, prefix)
      .build();
  }
}

export default InlineKeyboardBuilder;
