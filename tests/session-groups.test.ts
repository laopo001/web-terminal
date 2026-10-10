import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionInfo } from '../src/shared/protocol';
import { loadTabLayout, parseTabLayout, reconcileTabLayout, saveTabLayout, sessionTabBlocks, updateTabLayout, type TabLayout, type TabLayoutAction } from '../src/client/sessionGroups.ts';

const ids = ['a', 'b', 'c', 'd'];
const fresh = () => reconcileTabLayout({ order: [], groups: [] }, ids);
const update = (layout: TabLayout, action: TabLayoutAction) => updateTabLayout(layout, ids, action);
const create = (layout: TabLayout, sessionId: string, id = 'project') => update(layout, { type: 'create', id, sessionId, name: '项目', color: 'blue' });
const sessions: SessionInfo[] = ids.map(id => ({ id, name: id, cwd: '/', createdAt: '', running: true }));
const flattened = (layout: TabLayout) => sessionTabBlocks(sessions, layout).flatMap(block => block.sessions.map(session => session.id));

test('本机标签置前、前后移动与拖放保留顺序，不改变服务端会话列表', () => {
  let layout = fresh();
  const original = structuredClone(sessions);
  layout = update(layout, { type: 'move', item: {kind:'session',id:'c'}, direction:'first' });
  assert.deepEqual(flattened(layout), ['c', 'a', 'b', 'd']);
  layout = update(layout, { type: 'move', item: {kind:'session',id:'a'}, direction:1 });
  assert.deepEqual(flattened(layout), ['c', 'b', 'a', 'd']);
  layout = update(layout, { type:'drop', item:{kind:'session',id:'b'}, target:{kind:'session',id:'d',side:'after'} });
  assert.deepEqual(flattened(layout), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sessions, original);
});

test('跨分组拖放、整组排序和组内置前，成员始终只出现一次', () => {
  let layout = create(fresh(), 'b');
  layout = update(layout, {type:'assign',sessionId:'d',groupId:'project'});
  assert.deepEqual(layout.order, ['session:a', 'group:project', 'session:c']);
  assert.deepEqual(layout.groups[0].sessionIds, ['b', 'd']);
  layout = create(layout, 'c', 'other');
  layout = update(layout, {type:'drop',item:{kind:'session',id:'d'},target:{kind:'session',id:'c',side:'before'}});
  assert.deepEqual(layout.groups.map(group => group.sessionIds), [['b'], ['d', 'c']]);
  layout = update(layout, {type:'move',item:{kind:'group',id:'other'},direction:'first'});
  assert.deepEqual(flattened(layout), ['d', 'c', 'a', 'b']);
  layout = update(layout, {type:'move',item:{kind:'session',id:'c'},direction:'first'});
  assert.deepEqual(flattened(layout), ['c', 'd', 'a', 'b']);
  layout = update(layout, {type:'drop',item:{kind:'session',id:'a'},target:{kind:'group',id:'other'}});
  assert.deepEqual(layout.groups[1].sessionIds, ['c', 'd', 'a']);
  assert.equal(new Set(flattened(layout)).size, 4);
});

test('取消分组保留成员位置，拖出分组和删除末个成员后清理空组', () => {
  let layout = create(fresh(), 'b');
  layout = update(layout, {type:'assign',sessionId:'c',groupId:'project'});
  layout = update(layout, {type:'ungroup',id:'project'});
  assert.deepEqual(flattened(layout), ids);
  assert.deepEqual(layout.groups, []);
  layout = create(layout, 'b');
  layout = update(layout, {type:'drop',item:{kind:'session',id:'b'},target:{kind:'end'}});
  assert.deepEqual(layout.groups, []);
  assert.deepEqual(flattened(layout), ['a', 'c', 'd', 'b']);
  layout = create(layout, 'c');
  layout = reconcileTabLayout(layout, ['a', 'b', 'd', 'new']);
  assert.deepEqual(layout.order, ['session:a', 'session:d', 'session:b', 'session:new']);
  assert.deepEqual(layout.groups, []);
});

test('刷新恢复名称、颜色、折叠与顺序，新会话只追加到末尾', () => {
  let layout = create(fresh(), 'a');
  layout = update(layout, {type:'edit',id:'project',name:'常用命令',color:'purple'});
  layout = update(layout, {type:'toggle',id:'project'});
  layout = update(layout, {type:'move',item:{kind:'session',id:'d'},direction:'first'});
  const restored = reconcileTabLayout(parseTabLayout(JSON.parse(JSON.stringify(layout))), [...ids, 'new']);
  assert.deepEqual(restored.groups, layout.groups);
  assert.deepEqual(restored.order, [...layout.order, 'session:new']);
  assert.equal(restored.groups[0].collapsed, true);
  assert.deepEqual(restored.groups[0].sessionIds, ['a']);
});

test('两个客户端独立保存布局，读取及保存失败有明确契约', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const a = new Map<string, string>(), b = new Map<string, string>();
  const use = (data: Map<string, string>) => Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{ getItem:(key:string)=>data.get(key)??null, setItem:(key:string,value:string)=>data.set(key,value) } });
  try {
    use(a); const left = create(fresh(), 'a'); saveTabLayout(left);
    use(b); assert.deepEqual(loadTabLayout(), {order:[],groups:[]});
    const right = update(fresh(), {type:'move',item:{kind:'session',id:'d'},direction:'first'}); saveTabLayout(right);
    use(a); assert.deepEqual(loadTabLayout(), left);
    use(b); assert.deepEqual(loadTabLayout(), right);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get:()=>{throw new Error('denied');}});
    assert.deepEqual(loadTabLayout(), {order:[],groups:[]});
    assert.throws(()=>saveTabLayout(left), /denied/);
  } finally { if(previous) Object.defineProperty(globalThis,'localStorage',previous); else Reflect.deleteProperty(globalThis,'localStorage'); }
});

test('损坏的本地记录不会隐藏会话，重复成员和失效拖放会被清理', () => {
  const layout = reconcileTabLayout(parseTabLayout({order:['group:g','session:a','group:g','bad'],groups:[
    {id:'g',name:'组',color:'blue',collapsed:true,sessionIds:['a','a','missing']},
    {id:'h',name:'重复',color:'green',sessionIds:['a','b']},
    {id:'evil',name:'错误',color:'url(evil)',sessionIds:['c']},
  ]}), ids);
  assert.deepEqual(flattened(layout), ids);
  assert.deepEqual(layout.groups.map(group=>group.sessionIds), [['a'],['b']]);
  assert.deepEqual(update(layout,{type:'drop',item:{kind:'group',id:'g'},target:{kind:'group',id:'missing'}}),layout);
  assert.deepEqual(update(layout,{type:'assign',sessionId:'c',groupId:null}),layout);
});

test('连续分组和拖动始终保留全部标签，且不改写此前保存的布局', () => {
  let layout = fresh();
  let seed = 731;
  const random = (n:number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  for(let index=0;index<300;index++) {
    const id = ids[random(ids.length)];
    const group = layout.groups[random(Math.max(1,layout.groups.length))];
    const choice = random(7);
    const action:TabLayoutAction = choice===0 ? {type:'create',id:`g${index}`,sessionId:id,name:'组',color:'blue'}
      : choice===1 ? {type:'assign',sessionId:id,groupId:group?.id??null}
      : choice===2 && group ? {type:'ungroup',id:group.id}
      : choice===3 && group ? {type:'toggle',id:group.id}
      : choice===4 ? {type:'move',item:{kind:'session',id},direction:'first'}
      : choice===5 && group ? {type:'drop',item:{kind:'session',id},target:{kind:'group',id:group.id}}
      : {type:'drop',item:{kind:'session',id},target:{kind:'session',id:ids[random(ids.length)],side:random(2)?'before':'after'}};
    const before = structuredClone(layout);
    const next = update(layout,action);
    assert.deepEqual(layout,before);
    assert.deepEqual([...flattened(next)].sort(), ids);
    layout=next;
  }
});
