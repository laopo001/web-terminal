export function defaultTerminalFont(platform: string): string {
  return /win/i.test(platform)
    ? '"Cascadia Code", Consolas, "Microsoft YaHei", "微软雅黑", monospace'
    : '"Cascadia Code", "JetBrains Mono", Consolas, monospace';
}
