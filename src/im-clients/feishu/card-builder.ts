/**
 * 飞书卡片构建器
 * 用于构建飞书 Card 2.0 格式的卡片
 */

import { CardContent } from '../../interfaces/im-client.interface';
import { Logger } from '../../utils/logger';

/**
 * 卡片元素类型
 */
export enum CardElementType {
  MARKDOWN = 'markdown',
  DIVIDER = 'hr',
  BUTTON = 'button',
  IMAGE = 'img',
  NOTE = 'note',
}

/**
 * 按钮样式
 */
export enum ButtonStyle {
  DEFAULT = 'default',
  PRIMARY = 'primary',
  DANGER = 'danger',
}

/**
 * 按钮配置
 */
export interface ButtonConfig {
  text: string;
  url?: string;
  type?: 'default' | 'primary' | 'danger';
}

/**
 * 图片配置
 */
export interface ImageConfig {
  key: string;
  alt?: string;
  preview?: boolean;
}

/**
 * 卡片构建器类
 */
export class CardBuilder {
  private elements: any[] = [];
  private title?: string;
  private version: string = '2.0';
  private config: {
    wideScreenMode?: boolean;
  } = {};
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CardBuilder');
  }

  /**
   * 设置卡片标题
   */
  setTitle(title: string): CardBuilder {
    this.title = title;
    return this;
  }

  /**
   * 设置卡片版本
   */
  setVersion(version: string): CardBuilder {
    this.version = version;
    return this;
  }

  /**
   * 设置宽屏模式
   */
  setWideScreenMode(enabled: boolean): CardBuilder {
    this.config.wideScreenMode = enabled;
    return this;
  }

  /**
   * 添加Markdown内容
   */
  addMarkdown(content: string): CardBuilder {
    if (!content || content.trim() === '') {
      this.logger.warn('Attempted to add empty markdown content');
      return this;
    }

    this.elements.push({
      tag: CardElementType.MARKDOWN,
      content: content,
    });

    return this;
  }

  /**
   * 添加分割线
   */
  addDivider(): CardBuilder {
    this.elements.push({
      tag: CardElementType.DIVIDER,
    });

    return this;
  }

  /**
   * 添加按钮
   */
  addButton(config: ButtonConfig): CardBuilder {
    const button: any = {
      tag: CardElementType.BUTTON,
      text: {
        tag: 'plain_text',
        content: config.text,
      },
      type: config.type || ButtonStyle.DEFAULT,
    };

    if (config.url) {
      button.url = config.url;
    }

    this.elements.push({
      tag: 'action',
      actions: [button],
    });

    return this;
  }

  /**
   * 添加多个按钮
   */
  addButtons(configs: ButtonConfig[]): CardBuilder {
    const actions = configs.map(config => ({
      tag: CardElementType.BUTTON,
      text: {
        tag: 'plain_text',
        content: config.text,
      },
      type: config.type || ButtonStyle.DEFAULT,
      ...(config.url && { url: config.url }),
    }));

    this.elements.push({
      tag: 'action',
      actions: actions,
    });

    return this;
  }

  /**
   * 添加图片
   */
  addImage(config: ImageConfig): CardBuilder {
    const image: any = {
      tag: CardElementType.IMAGE,
      img_key: config.key,
      alt: {
        tag: 'plain_text',
        content: config.alt || 'Image',
      },
    };

    if (config.preview !== undefined) {
      image.preview = config.preview;
    }

    this.elements.push(image);

    return this;
  }

  /**
   * 添加备注
   */
  addNote(content: string): CardBuilder {
    this.elements.push({
      tag: CardElementType.NOTE,
      elements: [
        {
          tag: 'plain_text',
          content: content,
        },
      ],
    });

    return this;
  }

  /**
   * 添加自定义元素
   */
  addCustomElement(element: any): CardBuilder {
    this.elements.push(element);
    return this;
  }

  /**
   * 构建卡片内容
   */
  build(): CardContent {
    const card: CardContent = {
      elements: this.elements,
    };

    if (this.title) {
      card.title = this.title;
    }

    if (this.version) {
      card.version = this.version;
    }

    if (Object.keys(this.config).length > 0) {
      card.config = this.config;
    }

    this.logger.debug('Card built successfully', {
      elementCount: this.elements.length,
      hasTitle: !!this.title,
    });

    return card;
  }

  /**
   * 构建为JSON字符串
   */
  buildJson(): string {
    const card = this.build();
    return JSON.stringify({
      schema: this.version,
      body: {
        title: this.title ? {
          tag: 'plain_text',
          content: this.title,
        } : undefined,
        elements: card.elements,
      },
      config: this.config,
    }, (key, value) => {
      // 过滤undefined值
      if (value === undefined) {
        return null;
      }
      return value;
    });
  }

  /**
   * 重置构建器
   */
  reset(): CardBuilder {
    this.elements = [];
    this.title = undefined;
    this.version = '2.0';
    this.config = {};
    return this;
  }

  /**
   * 创建加载状态的卡片
   */
  static createLoadingCard(message: string = '⏳ 思考中...'): string {
    const builder = new CardBuilder();
    builder.addMarkdown(message);
    return builder.buildJson();
  }

  /**
   * 创建错误卡片
   */
  static createErrorCard(error: string): string {
    const builder = new CardBuilder();
    builder.addMarkdown(`❌ **错误**\n\n${error}`);
    return builder.buildJson();
  }

  /**
   * 创建文本卡片
   */
  static createTextCard(text: string): string {
    const builder = new CardBuilder();
    builder.addMarkdown(text);
    return builder.buildJson();
  }

  /**
   * 从Markdown创建卡片
   */
  static fromMarkdown(markdown: string, title?: string): string {
    const builder = new CardBuilder();
    if (title) {
      builder.setTitle(title);
    }
    builder.addMarkdown(markdown);
    return builder.buildJson();
  }

  /**
   * 创建代码块卡片
   */
  static createCodeCard(code: string, language?: string, title?: string): string {
    const builder = new CardBuilder();
    if (title) {
      builder.setTitle(title);
    }

    const codeBlock = language
      ? `\`\`\`${language}\n${code}\n\`\`\``
      : `\`\`\`\n${code}\n\`\`\``;

    builder.addMarkdown(codeBlock);
    return builder.buildJson();
  }
}
