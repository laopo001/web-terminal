export interface LineBaseTerminal {
  readonly rows: number;
  readonly buffer: {
    readonly active: {
      readonly type: string;
      readonly baseY: number;
      readonly cursorY: number;
      readonly length: number;
      getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
  registerMarker(cursorYOffset?: number): { readonly line: number; dispose(): void } | undefined;
}

interface NormalSnapshot {
  baseY: number;
  length: number;
  viewport: string[];
}

/** 跟踪终端缓冲各行输出时的工作目录，处理滚屏挤出、TUI 光标上移重绘与备选缓冲隔离。 */
export class LineBaseTracker {
  private normalBases = new Map<number, string>();
  private altBases = new Map<number, string>();
  private savedNormal?: NormalSnapshot;

  clear() {
    this.normalBases.clear();
    this.altBases.clear();
    this.savedNormal = undefined;
  }

  get(term: LineBaseTerminal, row: number): string {
    const map = term.buffer.active.type === 'alternate' ? this.altBases : this.normalBases;
    return map.get(row) ?? '';
  }

  async recordOutput(
    term: LineBaseTerminal,
    base: string,
    write: () => Promise<void>,
    isDisposed: () => boolean = () => false,
  ) {
    const beforeBuffer = term.buffer.active;
    const beforeNormal = beforeBuffer.type === 'normal';
    const beforeBaseY = beforeBuffer.baseY;
    const beforeRow = beforeBaseY + beforeBuffer.cursorY;
    const beforeLength = beforeBuffer.length;
    const beforeViewport: string[] = [];
    let marker: { readonly line: number; dispose(): void } | undefined;
    if (beforeNormal) {
      for (let i = 0; i < term.rows; i++) {
        beforeViewport.push(beforeBuffer.getLine(beforeBaseY + i)?.translateToString(false) ?? '');
      }
      marker = term.registerMarker(0);
    }

    try {
      await write();
    } finally {
      if (isDisposed()) {
        marker?.dispose();
      } else {
        const shifted = marker
          ? (marker.line === -1 ? Math.max(0, beforeRow + 1) : Math.max(0, beforeRow - marker.line))
          : 0;
        marker?.dispose();

        const afterBuffer = term.buffer.active;
        if (afterBuffer.type === 'alternate') {
          if (beforeNormal && !this.savedNormal) {
            this.savedNormal = { baseY: beforeBaseY, length: beforeLength, viewport: beforeViewport };
          }
          if (base) {
            this.altBases.clear();
            for (let row = 0; row < afterBuffer.length; row++) this.altBases.set(row, base);
          }
        } else {
          this.altBases.clear();
          const saved = !beforeNormal ? this.savedNormal : undefined;
          this.savedNormal = undefined;
          if (beforeNormal && shifted > 0) {
            const next = new Map<number, string>();
            for (const [row, dir] of this.normalBases) {
              const target = row - shifted;
              if (target >= 0) next.set(target, dir);
            }
            this.normalBases = next;
          }
          if (base) {
            const afterBaseY = afterBuffer.baseY;
            const afterRow = afterBaseY + afterBuffer.cursorY;
            const afterLength = afterBuffer.length;
            if (beforeNormal) {
              const adjustedStart = Math.max(0, beforeRow - shifted);
              const rangeStart = Math.min(adjustedStart, afterRow);
              const rangeEnd = Math.min(afterLength - 1, Math.max(adjustedStart, afterRow));
              for (let row = rangeStart; row <= rangeEnd; row++) this.normalBases.set(row, base);

              const prevEnd = beforeLength - 1 - shifted;
              for (let row = Math.max(0, prevEnd + 1); row < afterLength; row++) this.normalBases.set(row, base);

              const scanStart = Math.max(0, Math.min(beforeBaseY - shifted, afterBaseY));
              const scanEnd = Math.min(afterLength - 1, afterBaseY + term.rows - 1);
              for (let row = scanStart; row <= scanEnd; row++) {
                const oldIndex = row + shifted - beforeBaseY;
                if (oldIndex < 0 || oldIndex >= beforeViewport.length) continue;
                const currentText = afterBuffer.getLine(row)?.translateToString(false) ?? '';
                if (currentText !== beforeViewport[oldIndex]) this.normalBases.set(row, base);
              }
            } else if (saved) {
              for (let row = saved.length; row < afterLength; row++) this.normalBases.set(row, base);
              const scanEnd = Math.min(afterLength - 1, afterBaseY + term.rows - 1);
              for (let row = afterBaseY; row <= scanEnd; row++) {
                const oldIndex = row - saved.baseY;
                const currentText = afterBuffer.getLine(row)?.translateToString(false) ?? '';
                if (oldIndex < 0 || oldIndex >= saved.viewport.length || currentText !== saved.viewport[oldIndex]) {
                  this.normalBases.set(row, base);
                }
              }
            } else {
              this.normalBases.set(afterRow, base);
            }
          }
        }
      }
    }
  }
}
