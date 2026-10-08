import type { WorkspaceFolder } from '../../../src/shared/protocol.js';
import { errorHtml, iframeHtml } from './html.js';

/** 每个 Webview 独立处理异步加载，侧栏与编辑器互不取消请求。 */
export class WebviewContent {
  private displayedUrl?: string;
  private requestId = 0;
  private disposed = false;
  private ready = false;
  private pending: unknown[] = [];

  receive(message: { type?: string }): void {
    if (this.disposed || message?.type !== 'web-terminal:bridge-ready') return;
    this.ready = true;
    for (const item of this.pending.splice(0)) this.webview.postMessage?.(item);
  }

  sendAttachment(attachment: { id: string; name: string; text: string }): void {
    if (this.disposed) return;
    const message = { type: 'web-terminal:text-attachment', attachment };
    if (this.ready) this.webview.postMessage?.(message);
    else this.pending.push(message);
  }

  constructor(private readonly webview: { html: string; postMessage?: (message: unknown) => unknown }, private readonly resolveUrl: () => Promise<string>, private readonly folders: () => WorkspaceFolder[] = () => []) {}

  async update(force = false): Promise<void> {
    const request = ++this.requestId;
    try {
      const url = await this.resolveUrl();
      if (this.disposed || request !== this.requestId || (!force && this.displayedUrl === url)) return;
      this.ready = false;
      this.webview.html = iframeHtml(url, undefined, this.folders());
      this.displayedUrl = url;
    } catch (error) {
      if (this.disposed || request !== this.requestId) return;
      this.ready = false;
      this.displayedUrl = undefined;
      this.webview.html = errorHtml(error instanceof Error ? error.message : String(error));
    }
  }

  updateFolders(): void { if (!this.disposed) this.webview.postMessage?.({ type: 'web-terminal:workspace-folders', folders: this.folders() }); }

  dispose(): void { this.disposed = true; this.requestId++; }
}
