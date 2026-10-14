import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJourney, mealAction } from '../public/journey.js';
import { selectionsFor, unitsForCart, acceptQuote, invalidateQuote, isQuoteCurrent, makeShareText, SHARED_OWNER } from '../public/live-state.js';
import { assignWishes, preserveOwners } from '../public/wish-planner.js';
import { createApi, normalizeDetail } from '../server/api.mjs';

const sample=JSON.parse(await readFile(new URL('./fixtures/mcd-sample.json',import.meta.url)));
const detail=normalizeDetail(sample.detail);
const people=[{id:'p1',name:'阿橙',wants:{chicken:1,fries:1,cola:1}},{id:'p2',name:'小蓝',wants:{chicken:1,cola:1}}];

test('both entrances reach the shared table and switching does not own or reset meal data',()=>{
  const journey=createJourney(), cart=[{id:'chosen'}], meal={cart,quote:{total:9000},owners:['p1',SHARED_OWNER]};
  const before=structuredClone(meal);
  assert.equal(journey.view,'home');assert.equal(journey.go('table'),false);
  assert.equal(journey.choose('wishes'),true);assert.equal(journey.view,'wishes');
  journey.go('table');journey.go('menu');assert.equal(journey.mode,'wishes');
  journey.go('home');journey.choose('menu');assert.equal(journey.view,'menu');
  journey.go('table');journey.go('wishes');assert.equal(journey.mode,'wishes');
  assert.deepEqual(meal,before);assert.equal(meal.cart,cart);
  assert.equal(journey.choose('checkout'),false);assert.equal(journey.go('checkout'),false);
});

test('the shared action permits allocation while quoting but never sharing an unpriced or expired meal',()=>{
  assert.equal(mealAction({view:'home',hasItems:true,valid:true}),null);
  assert.equal(mealAction({view:'wishes',hasItems:true,valid:true}),null);
  assert.equal(mealAction({view:'menu',hasItems:false}),null);
  assert.deepEqual(mealAction({view:'menu',hasItems:true,pending:true}),{action:'table',label:'选好了，分给大家',disabled:false});
  assert.equal(mealAction({view:'table',hasItems:true,pending:true,valid:true}).disabled,true);
  assert.equal(mealAction({view:'table',hasItems:true,valid:false}).action,'quote');
  assert.equal(mealAction({view:'table',hasItems:true,valid:true}).action,'share');
});

test('intentional sharing survives cart changes and remains distinct from unassigned food in the exported meal',()=>{
  const previous=[{id:'l1-0',code:'1',name:'薯条',owner:SHARED_OWNER},{id:'l1-1',code:'2',name:'咖啡',owner:'p1'}];
  const current=[{id:'l1-0',code:'2',name:'咖啡'},{id:'l1-1',code:'1',name:'薯条'},{id:'l1-2',code:'3',name:'可乐'}];
  const units=preserveOwners(current,previous,people);
  assert.deepEqual(units.map(u=>u.owner),['p1',SHARED_OWNER,null]);
  const state={store:{name:'测试餐厅'},cart:[],revision:0,quote:null};
  const text=makeShareText(state,people,units,[]);
  assert.match(text,/阿橙：咖啡/);assert.match(text,/大家一起吃：薯条/);assert.match(text,/待分配：可乐/);
  assert.doesNotMatch(text,/待分配：.*薯条/);
});

function fixtureApi(){
  const calls=[];
  const api=createApi(async()=>({async call(name,args){
    calls.push(name);
    if(name==='query-meals')return {categories:[{name:'分享餐',meals:[{code:detail.code}]}],meals:{[detail.code]:sample.menu.meals[detail.code]}};
    if(name==='query-meal-detail')return sample.detail;
    if(name==='calculate-price'){
      const productList=args.items.map(item=>({productCode:item.productCode,productName:detail.name,quantity:item.quantity,subtotal:item.quantity*(item.roundList.some(r=>r.comboItemList.some(c=>c.code==='507411'))?12350:11450)}));
      return {price:productList.reduce((n,p)=>n+p.subtotal,0),productList};
    }
    throw new Error('Unexpected MCP tool');
  }}));
  return {calls,async request(route,body){const response=await api(new Request(`https://site.test/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{MCD_MCP_TOKEN:'fixture-only'});assert.equal(response.status,200);return response.json();}};
}

for(const mode of ['wishes','menu'])test(`${mode} flow: choose -> quote -> assign -> change drink -> reprice -> share with preserved meal on mode switch`,async()=>{
  const journey=createJourney();journey.choose(mode);
  const api=fixtureApi();
  const state={store:{code:'1450713',name:'测试门店'},revision:1,quote:null,cart:[]};
  if(mode==='wishes'){
    const plans=await api.request('plans',{storeCode:state.store.code,revision:1,people:people.map(({id,wants})=>({id,wants})),budget:30000});
    assert.ok(plans.plans.length);state.cart=plans.plans[0].cart.map((c,i)=>({...c,id:`l${i+1}`}));
  }else state.cart=[{id:'l1',code:detail.code,name:detail.name,quantity:1,detail,selections:selectionsFor(detail)}];
  const quote=async()=>api.request('quote',{storeCode:state.store.code,revision:state.revision,items:state.cart.map(({id,code,quantity,selections})=>({id,code,quantity,selections}))});
  assert.equal(acceptQuote(state,await quote()),true);assert.equal(isQuoteCurrent(state),true);
  let units=mode==='wishes'?assignWishes(unitsForCart(state.cart),people):unitsForCart(state.cart).map((u,i)=>({...u,owner:i===0?'p1':SHARED_OWNER}));
  journey.go('table');
  const before=structuredClone({cart:state.cart,units,quote:state.quote});
  journey.go('home');journey.choose(mode==='wishes'?'menu':'wishes');journey.go('table');
  assert.deepEqual({cart:state.cart,units,quote:state.quote},before);
  const drink=state.cart[0].selections.find(r=>r.roundId==='6');
  drink.choices=[{code:'3050',quantity:1},{code:'507411',quantity:1}];
  invalidateQuote(state);assert.equal(mealAction({view:'table',hasItems:true,valid:isQuoteCurrent(state)}).action,'quote');
  units=preserveOwners(unitsForCart(state.cart),units,people);
  const changed=await quote();assert.equal(acceptQuote(state,changed),true);
  assert.ok(changed.units.some(u=>u.code==='507411'));assert.ok(api.calls.includes('calculate-price'));
  assert.equal(mealAction({view:'table',hasItems:true,valid:isQuoteCurrent(state)}).action,'share');
  const text=makeShareText(state,people,units,[]);
  assert.match(text,/冰美式/);assert.match(text,/官方核价合计/);assert.match(text,/测试门店/);
  assert.doesNotMatch(makeShareText(state,people,units,[],state.quote.expiresAt),/官方核价合计/);
  if(mode==='menu')assert.equal(api.calls.includes('query-nearby-stores'),false);
});
