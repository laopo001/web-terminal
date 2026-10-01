/** 快照补回尚未结束的控制序列，确保在任意 PTY 分块边界连接都能继续解析。 */
export class EscapeTail {
  private state: 'text' | 'escape' | 'csi' | 'string' = 'text';
  private osc = false;
  private escaped = false;
  private tail = '';
  private overflow = false;
  push(data: string) {
    for (const char of data) {
      if (char === '\x18' || char === '\x1a') { this.reset(); continue; }
      if (this.state === 'text') {
        if (char === '\x1b') { this.state = 'escape'; this.tail = char; }
        else if (char === '\x9b') { this.state = 'csi'; this.tail = char; }
        else if (['\x90', '\x9d', '\x98', '\x9e', '\x9f'].includes(char)) { this.state = 'string'; this.osc = char === '\x9d'; this.tail = char; }
        continue;
      }
      if (this.tail.length < 65536) this.tail += char; else this.overflow = true;
      if (this.state === 'string') {
        if (char === '\x9c' || (this.osc && char === '\x07') || (this.escaped && char === '\\')) this.reset();
        else this.escaped = char === '\x1b';
      } else if (char === '\x1b') { this.state = 'escape'; this.tail = char; this.overflow = false; }
      else if (this.state === 'escape') {
        if (char === '[') this.state = 'csi';
        else if (']PX^_'.includes(char)) { this.state = 'string'; this.osc = char === ']'; }
        else if (char >= '0' && char <= '~') this.reset();
      } else if (char >= '@' && char <= '~') this.reset();
    }
  }
  value() {
    if (this.overflow) throw new Error('控制序列尚未结束，请稍后重连');
    return this.tail;
  }
  private reset() { this.state = 'text'; this.tail = ''; this.osc = false; this.escaped = false; this.overflow = false; }
}
