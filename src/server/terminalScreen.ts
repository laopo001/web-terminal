import { EscapeTail } from './escapeTail.ts';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';

/** 当前画面是恢复依据，原始输出仅在连接期间增量传输。 */
export class TerminalScreen {
  readonly terminal = new headless.Terminal({ cols: 100, rows: 30, scrollback: 2000, allowProposedApi: true });
  private tail = new EscapeTail();
  private serializer = new serialize.SerializeAddon();
  private queue = Promise.resolve();
  private closed = false;
  private cursorVisible = true;
  private mouseEncoding = 0;
  private margins: [number, number] = [1, 30];
  constructor(onTitle: (title: string) => void, onResponse: (data: string) => void) {
    this.terminal.loadAddon(this.serializer);
    this.terminal.onTitleChange(title => onTitle(title.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512)));
    this.terminal.onData(onResponse);
    for (const [code, color] of [[10, 'd8d8/e3e3/e8e8'], [11, '1010/1818/2121']] as const) {
      this.terminal.parser.registerOscHandler(code, data => {
        if (data !== '?') return false;
        onResponse(`\x1b]${code};rgb:${color}\x1b\\`); return true;
      });
    }
    for (const final of ['h', 'l']) this.terminal.parser.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.includes(25)) this.cursorVisible = final === 'h';
      for (const mode of params) if (mode === 1006 || mode === 1016) this.mouseEncoding = final === 'h' ? mode : 0;
      return false;
    });
    this.terminal.parser.registerCsiHandler({ final: 'r' }, params => {
      const top = Number(params[0]) || 1, bottom = Number(params[1]) || this.terminal.rows;
      if (top < bottom && bottom <= this.terminal.rows) this.margins = [top, bottom];
      return false;
    });
    this.terminal.parser.registerEscHandler({ final: 'c' }, () => { this.cursorVisible = true; this.mouseEncoding = 0; this.margins = [1, this.terminal.rows]; return false; });
  }
  run(operation: () => void | Promise<void>): Promise<void> {
    const task = this.queue.then(() => { if (!this.closed) return operation(); });
    this.queue = task.catch(() => {});
    return task;
  }
  write(data: string, after: () => void) {
    return this.run(() => new Promise<void>((resolve, reject) => this.terminal.write(data, () => { try { this.tail.push(data); after(); resolve(); } catch (error) { reject(error); } })));
  }
  resize(cols: number, rows: number) {
    this.terminal.resize(cols, rows); this.margins = [1, rows];
  }
  snapshot() {
    const term = this.terminal;
    const row = term.buffer.active.cursorY + 1 - (term.modes.originMode ? this.margins[0] - 1 : 0);
    const col = term.buffer.active.cursorX + 1;
    return { cols: term.cols, rows: term.rows,
      data: this.serializer.serialize() + (this.mouseEncoding ? `\x1b[?${this.mouseEncoding}h` : '') + (this.margins[0] !== 1 || this.margins[1] !== term.rows ? `\x1b[${this.margins[0]};${this.margins[1]}r\x1b[${row};${col}H` : '') + `\x1b[?25${this.cursorVisible ? 'h' : 'l'}` + this.tail.value() };
  }
  async dispose() { await this.queue; this.closed = true; this.terminal.dispose(); }
}
