import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, distribute, moveUnit, needsFor, shareText, SCENARIOS, FOODS, demandFor } from '../public/engine.js';

test('three friends: a sharing box and a coffee cost 72, with no unwanted food', () => {
  const plan = solve(SCENARIOS[0].people);
  assert.equal(plan.baseline, 9000);
  assert.equal(plan.cost, 7200);
  assert.equal(plan.saving, 1800);
  assert.equal(plan.extraCount, 0);
  assert.deepEqual(plan.bundles.map(b=>[b.id,b.quantity]).sort(), [['friends-box',1],['single-coffee',1]]);
});
test('budget mode reveals the two unwanted items in the cheaper 69 box', () => {
  const plan = solve(SCENARIOS[0].people,'budget');
  const units = distribute(plan, SCENARIOS[0].people);
  assert.equal(plan.cost, 6900);
  assert.equal(plan.extraCount, 2);
  assert.deepEqual(units.filter(u=>!u.owner).map(u=>u.foodId).sort(), ['cola','fries']);
});
test('singles comparison never bundles food', () => {
  const p = solve(SCENARIOS[0].people,'singles');
  assert.equal(p.cost,9000); assert.equal(p.saving,0);
  assert.ok(p.bundles.every(b=>b.single));
});
test('allocation preserves every purchased item and fulfils each persons distinct wishes', () => {
  for (const scenario of SCENARIOS) for (const mode of ['exact','budget','singles']) {
    const plan=solve(scenario.people,mode), units=distribute(plan,scenario.people);
    assert.equal(new Set(units.map(u=>u.id)).size,units.length);
    assert.equal(plan.cost,plan.bundles.reduce((n,b)=>n+b.price*b.quantity,0));
    for (const p of scenario.people) assert.deepEqual(needsFor(p,units),[]);
    assert.equal(units.filter(u=>!u.owner).length,plan.extraCount);
    assert.equal(units.length,demandFor(scenario.people).reduce((a,b)=>a+b,0)+plan.extraCount);
  }
});
test('moving food does not create inventory, mutate original units, or hide unmet wishes', () => {
  const people=SCENARIOS[0].people, original=distribute(solve(people),people);
  const coffee=original.find(u=>u.foodId==='coffee');
  const moved=moveUnit(original,coffee.id,'p2',people);
  assert.equal(original.find(u=>u.id===coffee.id).owner,'p1');
  assert.deepEqual(moved.map(u=>[u.id,u.foodId]),original.map(u=>[u.id,u.foodId]));
  assert.deepEqual(needsFor(people[0],moved),[{foodId:'coffee',missing:1,extra:0}]);
  assert.deepEqual(needsFor(people[1],moved),[{foodId:'coffee',missing:0,extra:1}]);
  const spare=moveUnit(moved,coffee.id,null,people);
  assert.equal(spare.filter(u=>!u.owner).length,1);
  assert.throws(()=>moveUnit(original,coffee.id,'unknown',people));
});
test('share export always discloses demo data, spare food and pending wishes', () => {
  const people=SCENARIOS[0].people, plan=solve(people,'budget');
  let units=distribute(plan,people);
  units=moveUnit(units,units.find(u=>u.foodId==='coffee').id,null,people);
  const text=shareText(plan,people,units,['p2']);
  for(const expected of ['【演示清单】','未连接麦当劳 MCP','待分配','待补：咖啡','✓ 小蓝','示例合计 ¥69','不代表其他人已在线确认']) assert.ok(text.includes(expected));
});
test('empty wishes do not purchase anything even with budget mode enabled', () => {
  for(const mode of ['exact','budget','singles']) {
    const p=solve([{id:'a',name:'A',wants:{}}],mode);
    assert.equal(p.cost,0);assert.deepEqual(p.bundles,[]);assert.deepEqual(p.units,[]);
  }
});
test('limits prevent oversized or invalid requests before combinatorial search', () => {
  assert.throws(()=>solve([{wants:{beef:9}}]));
  assert.throws(()=>solve([{wants:{beef:-1}}]));
  assert.throws(()=>solve([{wants:{beef:1.5}}]));
  assert.throws(()=>solve([{wants:{beef:8,chicken:8,fries:8}}]));
});
test('each single-food wish remains exact; unrelated products cannot slip into exact mode', () => {
  for (const f of FOODS) for (let q=1;q<=3;q++) {
    const p=solve([{id:'a',wants:{[f.id]:q}}]);
    assert.equal(p.units.length,q);assert.ok(p.units.every(u=>u.foodId===f.id));
    assert.equal(p.cost,q*f.price);
  }
});
test('all binary demand combinations are covered with quantity and price conservation', () => {
  for(let mask=1;mask<64;mask++) {
    const wants=Object.fromEntries(FOODS.map((f,i)=>[f.id,(mask>>i)&1]));
    const people=[{id:'a',wants}];
    const exact=solve(people),budget=solve(people,'budget');
    assert.ok(budget.cost<=exact.cost);assert.ok(exact.cost<=exact.baseline);
    for(const f of FOODS) assert.equal(exact.units.filter(u=>u.foodId===f.id).length,wants[f.id]);
    assert.deepEqual(needsFor(people[0],distribute(budget,people)),[]);
  }
});
