import type { Terminal } from '@xterm/xterm';

/** 查询由服务端终端回答一次，浏览器只渲染，避免多窗口重复回传或污染输入。 */
export function suppressTerminalResponses(term: Terminal) {
  const disposables = [
    ...[{ final: 'c' }, { prefix: '>', final: 'c' }, { final: 'n' }, { prefix: '?', final: 'n' },
      { intermediates: '$', final: 'p' }, { prefix: '?', intermediates: '$', final: 'p' }]
      .map(id => term.parser.registerCsiHandler(id, () => true)),
    term.parser.registerCsiHandler({ final: 't' }, params => [14, 16, 18, 20, 21].includes(Number(params[0]))),
    term.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true),
    ...[4, 10, 11, 12].map(id => term.parser.registerOscHandler(id, data => data.split(';').includes('?'))),
  ];
  return { dispose: () => disposables.forEach(item => item.dispose()) };
}
