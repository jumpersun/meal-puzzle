import { createWishPlanner } from './wishes.js';
import { createJourney, mealAction } from './journey.js';
import { createProductImages } from './product-images.js';
import { assignWishes, preserveOwners, personWishStatus, WISH_KINDS } from './wish-planner.js';
import { foodArt } from './art.js';
import { formatMoney, selectionsFor, reconcileSelections, selectionError, invalidateQuote, acceptQuote, isQuoteCurrent, unitsForCart, makeShareText, SHARED_OWNER } from './live-state.js';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clone = value => structuredClone(value);
const state = { store: null, cart: [], revision: 0, quote: null };
const journey = createJourney();
let editingStore = false, configured = false, pendingPlan = null;
let stores = [], menu = null, category = 0, units = [], people = [{ id:'p1',name:'阿橙' },{ id:'p2',name:'小蓝' },{ id:'p3',name:'小满' }];
let confirmed = [], previous = null, draft = null, personDraft = null, sequence = 10, quotePending = false, quoteError = '', expiration, quoteTicket = 0, detailTicket = 0, storeTicket = 0, menuTicket = 0, toastTimer, lastFocus, modalKind;
const controllers = new Map();
let quoteTimer;
const dialog = $('#dialog');
const colors = [['#f7dfcc','#b87847'],['#dce8eb','#5e858c'],['#e4e9d5','#7d8c56'],['#f1dfe1','#b47c81'],['#e7dff0','#8e74a5'],['#f3e9c9','#ac9858']];
const productImages = createProductImages({ load: ({storeCode,code,signal}) => api('detail',{storeCode,code},`image:${storeCode}:${code}`,signal), onChange: refreshTablePictures });
// Product pictures come from the menu by product code; never infer food type from its name.
const productPicture = product => {
  const image=product.image||menu?.products.find(p=>p.code===product.code)?.image||productImages.get(state.store?.code,product.code);
  return `<span class="product-image${image?'':' is-unavailable'}" data-product-code="${esc(product.code)}">${image?`<img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`:''}<span class="image-placeholder" ${image?'hidden':''}>暂无图片</span></span>`;
};
function refreshTablePictures() {
  // Patch only pictures: a late image must not replace focused buttons or a dragged dish.
  for(const picture of document.querySelectorAll('.live-table .product-image[data-product-code]')) {
    if(picture.querySelector('img'))continue;
    const unit=units.find(u=>u.code===picture.dataset.productCode),image=unit&&productImages.get(state.store?.code,unit.code);
    if(!image)continue;
    const img=document.createElement('img');img.src=image;img.alt=unit.name;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.draggable=false;
    picture.prepend(img);picture.classList.remove('is-unavailable');picture.querySelector('.image-placeholder').hidden=true;
  }
}
document.addEventListener('error',event=>{
  const img=event.target;if(!(img instanceof HTMLImageElement)||!img.closest('.product-image'))return;
  const picture=img.parentElement;picture.classList.add('is-unavailable');picture.querySelector('.image-placeholder').hidden=false;img.hidden=true;
},true);
const avatar = (p,i) => `<span class="avatar" style="--person-soft:${colors[i%6][0]};--person-ink:${colors[i%6][1]}">${esc(Array.from(p.name)[0])}</span>`;
const head = title => `<div class="dialog-head"><h2>${esc(title)}</h2><button class="close-dialog" data-action="close" aria-label="关闭弹窗">×</button></div>`;
function notify(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function openModal(html, kind) { modalKind=kind; lastFocus=document.activeElement; $('#dialog-content').innerHTML=html; if(!dialog.open)dialog.showModal(); }
function closeModal() { detailTicket++; controllers.get('detail')?.abort(); draft=null; pendingPlan=null; modalKind=null; dialog.close(); if(lastFocus?.isConnected)lastFocus.focus(); }
dialog.addEventListener('cancel',e=>{e.preventDefault();closeModal();});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
async function api(path, args, channel, signal) {
  controllers.get(channel)?.abort(); const controller=new AbortController(); controllers.set(channel,controller);
  const requestSignal=signal?AbortSignal.any([controller.signal,signal]):controller.signal;
  const timeout=setTimeout(()=>controller.abort('timeout'),channel==='plans'?120000:45000);
  try {
    const response=await fetch(`/api/${path}`,{method:args?'POST':'GET',headers:args?{'Content-Type':'application/json'}:{},body:args?JSON.stringify(args):undefined,signal:requestSignal});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('请刷新页面并完成站点登录，然后重试。');
    const data=await response.json();
    if(!response.ok)throw new Error(data.error?.message||'查询未完成，请重试。');
    return data;
  } catch(error) {
    if(requestSignal.aborted){if(controller.signal.reason==='timeout')throw new Error('请求用时较长，请稍后重试。');throw new DOMException('Cancelled','AbortError');}
    if(error instanceof TypeError)throw new Error('连接中断，请检查网络后重试。');
    throw error;
  } finally {clearTimeout(timeout);if(controllers.get(channel)===controller)controllers.delete(channel);}
}
function invalidate() {
  invalidateQuote(state); quoteTicket++; controllers.get('quote')?.abort(); clearTimeout(expiration); clearTimeout(quoteTimer); quotePending=false; quoteError='';
}
function cartChanged() {
  invalidate(); units=preserveOwners(unitsForCart(state.cart),units,people);confirmed=[];previous=null;renderCart();renderTable();planner.renderPlans();
}
function renderJourney() {
  const home=journey.view==='home', pickingStore=!state.store||editingStore, ready=Boolean(state.store)&&!editingStore;
  $('#home-hero').hidden=home===false;$('#mode-picker').hidden=!home;$('#journey-bar').hidden=home;
  $('#store-panel').hidden=home||!pickingStore;
  $('#wish-panel').hidden=home||!ready||journey.view!=='wishes';
  $('#live-workspace').hidden=home||!ready||!['menu','table'].includes(journey.view);
  $('#menu-panel').hidden=journey.view!=='menu';$('#table-panel').hidden=journey.view!=='table';
  $('#finish-bar').hidden=home||!ready||journey.view!=='table';
  $('#resume-table').hidden=!state.cart.length;
  $('#mode-note').textContent=state.cart.length?'已经选好的餐品和分配会保留，放心换个玩法。':'真实菜单 · 官方核价 · 1–6 位饭搭子';
  $('#journey-kicker').textContent=journey.mode==='wishes'?'WISHES TO A TABLE':'PICK, THEN SHARE';
  $('#journey-title').textContent=pickingStore?'先选一家餐厅':journey.view==='wishes'?'说说每个人想吃什么':journey.view==='menu'?'挑喜欢的，拼成这一桌':'这一桌，大家一起吃';
  $('#journey-store').textContent=state.store?`${state.store.name} · 到店自取`:'两种玩法都使用这家餐厅的实时菜单与核价。';
  $('#change-store').hidden=!state.store;$('#change-store').textContent=editingStore?'继续当前餐厅':'更换餐厅';
  $('#nav-wishes').textContent=journey.mode==='wishes'?'心愿与推荐':'补充心愿';
  $('#nav-menu').textContent=journey.mode==='wishes'?'自己加点':'挑选餐品';
  $('#nav-table').disabled=!state.cart.length;$('#journey-count').textContent=units.length;
  for(const b of document.querySelectorAll('.journey-nav [data-view]')) {
    b.setAttribute('aria-current',b.dataset.view===journey.view?'step':'false');
  }
  $('#assign-wishes').hidden=journey.mode!=='wishes';
  $('#table-tip').textContent=journey.mode==='wishes'?'点餐品可改归属或换搭配，也可以按心愿重新分好；多出的留给大家一起吃。':'点餐品分给饭搭子，或放到“大家一起吃”。改归属不改变价格。';
  renderDock();
}
function navigate(view, mode) {
  if(!(mode?journey.choose(mode):journey.go(view)))return;
  editingStore=false;renderTable();
  const target=journey.view==='home'?$('#mode-title'):$('#journey-title');
  target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  target.focus({preventScroll:true});
  if(!state.store&&configured&&!stores.length&&!$('#search-stores').disabled)searchStores();
}
function renderDock() {
  const action=mealAction({view:journey.view,hasItems:Boolean(units.length),pending:quotePending,valid:isQuoteCurrent(state)});
  $('#meal-dock').hidden=!action||editingStore;document.body.classList.toggle('has-meal-dock',Boolean(action)&&!editingStore);
  if(!action)return;
  $('#dock-label').textContent=`这一桌 · ${units.length} 份餐品`;
  $('#dock-price').textContent=quotePending?'核价中…':isQuoteCurrent(state)?`¥${formatMoney(state.quote.total)}`:'待重新核价';
  $('#dock-note').textContent=units.some(u=>!u.owner)?`还有 ${units.filter(u=>!u.owner).length} 份待分配，可留给大家一起吃`:'餐品已分好，也可以继续调整';
  $('#dock-next').textContent=action.label;$('#dock-next').disabled=action.disabled;$('#dock-next').dataset.next=action.action;
}
function renderStores() {
  $('#store-results').innerHTML=stores.map(s=>`<button class="store-option" data-store="${esc(s.code)}" aria-pressed="${state.store?.code===s.code}" ${s.open?'':'disabled'}><strong>${esc(s.name)}</strong><span>${esc(s.address)}</span><span>${s.open?'营业中':'当前暂停营业'} · ${esc(s.hours)}</span></button>`).join('');
  $('#selected-store').hidden=!state.store;
  if(state.store)$('#selected-store').innerHTML=`✓ 当前餐厅：${esc(state.store.name)}<small>${esc(state.store.address)} · 到店自取</small>`;
  renderJourney();
}
async function searchStores(event) {
  event?.preventDefault();const ticket=++storeTicket;$('#search-stores').disabled=true;$('#store-error').textContent='';$('#store-results').textContent='正在查找餐厅…';
  try {const data=await api('stores',{city:$('#city').value.trim(),keyword:$('#keyword').value.trim()},'stores');if(ticket!==storeTicket)return;stores=data.stores;renderStores();if(!stores.length)$('#store-results').textContent='这里暂时没有找到餐厅，试试附近路名。';}
  catch(e){if(e.name!=='AbortError'&&ticket===storeTicket){$('#store-results').textContent='';$('#store-error').textContent=e.message;}}
  finally {if(ticket===storeTicket)$('#search-stores').disabled=false;}
}
async function loadMenu() {
  if(!state.store)return; planner.invalidate(); const ticket=++menuTicket, code=state.store.code;
  productImages.clear(code);
  invalidate();renderQuote();menu=null;planner.render();$('#categories').innerHTML='';$('#menu-grid').innerHTML='';$('#menu-state').textContent='正在读取这家餐厅的实时菜单…';$('#menu-search').disabled=true;$('#refresh-menu').disabled=true;
  try {const data=await api('menu',{storeCode:code},'menu');if(ticket!==menuTicket||state.store.code!==code)return;menu=data;category=0;$('#menu-search').value='';$('#menu-search').disabled=false;renderMenu();planner.render();}
  catch(e){if(e.name!=='AbortError'&&ticket===menuTicket)$('#menu-state').textContent=`${e.message} 点击“刷新菜单”重试。`;}
  finally {if(ticket===menuTicket){$('#refresh-menu').disabled=false;planner.render();renderTable();}}
}
function chooseStore(code) {
  const store=stores.find(s=>s.code===code);if(!store||!store.open)return;
  if(state.store?.code===code)return;
  const choose=()=>{state.store=store;state.cart=[];editingStore=false;if(journey.view==='table')journey.go(journey.mode);cartChanged();detailTicket++;controllers.get('detail')?.abort();renderStores();loadMenu();};
  if(state.cart.length){openModal(head('换个地方碰头？')+'<p class="dialog-description">更换餐厅会清空当前餐单、分配和报价，新门店的菜单与价格可能不同。</p><div class="dialog-actions"><button class="secondary" data-action="close">继续这一桌</button><button class="primary" data-confirm-store="'+esc(code)+'">更换餐厅</button></div>','store');return;}
  choose();
}
function renderMenu() {
  if(!menu)return; const query=$('#menu-search').value.trim().toLowerCase();
  $('#categories').innerHTML=menu.categories.map((c,i)=>`<button data-category="${i}" aria-pressed="${i===category&&!query}">${esc(c.name)}</button>`).join('');
  const codes=new Set(menu.categories[category]?.codes||[]), products=menu.products.filter(p=>query?p.name.toLowerCase().includes(query):codes.has(p.code));
  $('#menu-count').textContent=`${menu.products.length} 款餐品`;
  $('#menu-state').textContent=products.length?'':'没有找到，换个关键词试试。';
  $('#menu-grid').innerHTML=products.map(p=>`<article class="menu-card">${productPicture(p)}<h3>${esc(p.name)}</h3><div class="menu-pricing">${p.displayPrice===null?'待核价':'¥'+formatMoney(p.displayPrice)}<small>${p.requiresCard?'购卡条件展示价':'菜单展示价 · 以核价为准'}</small></div>${p.condition||p.requiresCard?`<div class="condition-chip">${esc(p.condition||'含购卡条件')} · 查看条件</div>`:''}<button data-product="${p.code}" aria-label="选择${esc(p.name)}">选一份，看看搭配 ＋</button></article>`).join('');
}
async function editProduct(code, lineId) {
  const product=menu?.products.find(p=>p.code===code)||state.cart.find(c=>c.id===lineId);if(!product||!state.store)return;
  const storeCode=state.store.code, ticket=++detailTicket, existing=state.cart.find(c=>c.id===lineId);
  openModal(head(product.name)+'<p class="dialog-description">正在读取可选搭配…</p>','detail');
  try {const detail=await api('detail',{storeCode,code},'detail');if(ticket!==detailTicket||state.store.code!==storeCode||!dialog.open)return;
    const recovered=existing?reconcileSelections(detail,existing.selections):{selections:selectionsFor(detail),changed:false};
    draft={...product,id:existing?.id||`l${++sequence}`,quantity:existing?.quantity||1,detail,selections:recovered.selections,selectionChanged:recovered.changed,storeCode};renderDetail();
  } catch(e){if(e.name!=='AbortError'&&ticket===detailTicket)$('#dialog-content').innerHTML=head('这份餐品暂时没准备好')+`<p class="error-message">${esc(e.message)}</p>`;}
}
function conditionText(p) {
  if(p.requiresCard)return `${p.condition||'该展示价含购卡条件'}。本页不附加购买会员卡，当前核价可能高于菜单展示价。`;
  if(p.condition)return `${p.condition}。是否适用以本次官方整单核价为准；本页未指定优惠券。`;
  return '接口未标注额外优惠条件。菜单展示价仅供参考，以本次官方整单核价为准。';
}
function renderDetail() {
  const d=draft;if(!d)return;
  $('#dialog-content').innerHTML=head(d.name)+`<div class="detail-intro">${productPicture({...d,image:d.detail.image||d.image})}<div><div class="detail-price">${d.displayPrice===null?'待核价':'¥'+formatMoney(d.displayPrice)}</div><div class="detail-price-label">${d.requiresCard?'购卡条件展示价':'菜单展示价'} · 非本次应付金额</div></div></div><p class="detail-condition">${esc(conditionText(d))}</p><p class="detail-body-note">可更换下面的套餐选项；特调使用门店默认。商品图来自麦当劳菜单，以选配名称和份数为准。</p>${d.detail.rounds.map(r=>`<section class="detail-round"><h3>${esc(r.name)}<span class="round-hint" id="round-hint-${r.id}"></span></h3>${r.choices.map(c=>`<div class="option-row"><span class="option-name">${esc(c.name)}<small>${esc(c.difference)}${c.supportModify?' · 默认特调':''}</small></span><div class="counter"><button data-option="${c.code}" data-round="${r.id}" data-delta="-1" aria-label="减少${esc(c.name)}">−</button><span id="option-${r.id}-${c.code}"></span><button data-option="${c.code}" data-round="${r.id}" data-delta="1" aria-label="增加${esc(c.name)}">＋</button></div></div>`).join('')}</section>`).join('')}<p class="form-error" id="detail-error" role="alert"></p><div class="dialog-actions detail-actions"><div class="detail-quantity">份数<div class="counter"><button data-draft-quantity="-1" aria-label="减少套餐份数">−</button><span id="draft-quantity"></span><button data-draft-quantity="1" aria-label="增加套餐份数">＋</button></div></div><button class="primary" data-action="save-dish">${state.cart.some(c=>c.id===d.id)?'保存并重新核价':'加入餐桌并核价'} →</button></div>`;
  renderCounters();
  if(d.selectionChanged){const note=document.createElement('p');note.className='detail-body-note';note.setAttribute('role','status');note.textContent='套餐选项已更新：已保留可用搭配，移除失效项并调整超出上限的份数；新增选项组使用门店默认，请核对后保存。';$('#dialog-content').querySelector('.detail-body-note').after(note);}
}
function renderCounters() {
  if(!draft)return;$('#draft-quantity').textContent=draft.quantity;
  for(const r of draft.detail.rounds){const choices=draft.selections.find(s=>s.roundId===r.id)?.choices||[],count=choices.reduce((n,c)=>n+c.quantity,0);$(`#round-hint-${r.id}`).textContent=`需选 ${r.min===r.max?r.min:r.min+'–'+r.max} 份 · 已选 ${count} 份`;
    for(const c of r.choices)$(`#option-${r.id}-${c.code}`).textContent=choices.find(x=>x.code===c.code)?.quantity||0;
  }
  $('#detail-error').textContent=selectionError(draft.detail,draft.selections);
}
function adjustChoice(button) {
  const r=draft.detail.rounds.find(r=>r.id===button.dataset.round);if(!r)return;
  const choice=r.choices.find(c=>c.code===button.dataset.option), group=draft.selections.find(s=>s.roundId===r.id);if(!choice||!group)return;
  const current=group.choices.find(c=>c.code===choice.code), delta=Number(button.dataset.delta),max=choice.max>=0?Math.min(choice.max,r.max):r.max;
  const quantity=Math.max(0,Math.min(max,(current?.quantity||0)+delta));
  // Single-choice rounds behave like a radio choice; multi-quantity rounds permit replacing just one drink.
  if(delta>0&&r.max===1)group.choices=[];
  else group.choices=group.choices.filter(c=>c.code!==choice.code);
  if(quantity)group.choices.push({code:choice.code,quantity});renderCounters();
}
function saveDish() {
  const error=selectionError(draft.detail,draft.selections);if(error){$('#detail-error').textContent=error;return;}
  const next=state.cart.some(c=>c.id===draft.id)?state.cart.map(c=>c.id===draft.id?clone(draft):c):[...state.cart,clone(draft)];
  if(next.length>8||unitsForCart(next).length>60){$('#detail-error').textContent='这一桌最多 8 种餐品或套餐、60 份餐品。';return;}
  if(draft.storeCode!==state.store?.code){closeModal();return;}
  const editing=state.cart.some(c=>c.id===draft.id);
  state.cart=next;closeModal();cartChanged();requestQuote();notify(editing?'搭配已更新，正在重新核价':'已加入这一桌，可以继续挑选或分给大家');
}
function renderCart() {
  $('#cart-count').textContent=`${state.cart.reduce((n,c)=>n+c.quantity,0)} 份`;
  $('#cart-lines').innerHTML=state.cart.length?state.cart.map(c=>`<article class="cart-line"><h3>${esc(c.name)}</h3><p>${unitsForCart([{...c,quantity:1}]).map(u=>esc(u.name)).join(' · ')}</p>${c.condition||c.requiresCard?`<div class="condition-chip">${esc(c.condition||'含购卡条件')}</div>`:''}<div class="cart-line-actions"><button data-cart-quantity="${c.id}" data-delta="-1" aria-label="减少${esc(c.name)}份数" ${c.quantity===1?'disabled':''}>−</button><span>${c.quantity}</span><button data-cart-quantity="${c.id}" data-delta="1" aria-label="增加${esc(c.name)}份数" ${c.quantity===6?'disabled':''}>＋</button><button class="cart-edit" data-edit-line="${c.id}">换搭配</button><button class="cart-remove" data-remove-line="${c.id}">移除</button></div></article>`).join(''):'<div class="empty-cart">先挑一份喜欢的，<br>这一桌就从这里开始。</div>';
  $('#conditions-content').innerHTML=state.cart.length?state.cart.map(c=>`<p class="${c.condition||c.requiresCard?'':'standard-condition'}"><b>${esc(c.name)}</b>${c.displayPrice!==null?'菜单展示 ¥'+formatMoney(c.displayPrice)+'。':''}${esc(conditionText(c))}</p>`).join(''):'选入餐品后，会在这里列出每项优惠条件。';
  renderQuote();
}
function renderQuote() {
  const valid=isQuoteCurrent(state), q=state.quote;
  $('#quote').disabled=!state.cart.length||quotePending;$('#share').disabled=!valid||quotePending||!units.length;
  $('#quote').textContent=quotePending?'正在向麦当劳核价…':valid?'重新获取官方核价 ↻':'获取官方核价';
  if(quotePending)$('#quote-box').innerHTML='<div class="quote-idle"><span class="busy-spinner"></span>正在核清这一桌的实际价格…</div>';
  else if(quoteError)$('#quote-box').innerHTML=`<p class="quote-error">${esc(quoteError)}<br>本次没有可用报价。</p>`;
  else if(valid){const fees=q.fees.packing+q.fees.delivery+q.fees.tableware;$('#quote-box').innerHTML=`<div class="quote-label">本次官方核价合计</div><div class="quote-amount"><small>¥</small>${formatMoney(q.total)}</div><p class="quote-meta">${q.products.map(p=>`${esc(p.name)} ×${p.quantity} · ¥${formatMoney(p.subtotal)}`).join('<br>')}<br>${q.discount>0?'核价返回优惠 ¥'+formatMoney(q.discount)+'<br>':''}${fees?'费用合计 ¥'+formatMoney(fees)+'<br>':''}${new Date(q.quotedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} 核价 · 2 分钟后需刷新</p>`;}
  else $('#quote-box').innerHTML=`<div class="quote-idle">${q?'报价已过期，请重新核价。':state.cart.length?'餐单已变化，等待本次官方核价。':'选好这一桌后，在这里获取官方核价。'}</div>`;
  if(modalKind==='share'&&$('#share-text'))$('#share-text').value=makeShareText(state,people,units,confirmed);
  renderDock();
}
async function requestQuote() {
  clearTimeout(quoteTimer);
  if(!state.cart.length||!state.store)return;const revision=state.revision,storeCode=state.store.code,ticket=++quoteTicket;
  state.quote=null;quotePending=true;quoteError='';clearTimeout(expiration);renderQuote();
  const items=state.cart.map(c=>({id:c.id,code:c.code,quantity:c.quantity,selections:c.selections}));
  try {const result=await api('quote',{storeCode,revision,items},'quote');if(ticket!==quoteTicket||!acceptQuote(state,result))return;
    const oldUnits=new Map(units.map(u=>[u.id,u]));
    if(result.units.some(u=>oldUnits.get(u.id)?.code!==u.code))confirmed=[];
    units=result.units.map(u=>({...u,owner:oldUnits.get(u.id)?.code===u.code?oldUnits.get(u.id).owner:null}));
    state.cart=state.cart.map(c=>{const condition=result.conditions.find(p=>p.lineId===c.id);return condition?{...c,name:condition.name,displayPrice:condition.displayPrice,condition:condition.condition,requiresCard:condition.requiresCard}:c;});
    expiration=setTimeout(()=>renderQuote(),Math.max(0,result.expiresAt-Date.now())+50);renderCart();renderTable();
  } catch(e){if(e.name!=='AbortError'&&ticket===quoteTicket){quoteError=e.message;state.quote=null;}}
  finally {if(ticket===quoteTicket){quotePending=false;renderQuote();}}
}
function scheduleQuote() {
  clearTimeout(quoteTimer);quotePending=true;renderQuote();
  quoteTimer=setTimeout(requestQuote,350);
}
function foodToken(u) {const owner=u.owner===SHARED_OWNER?'大家一起吃':people.find(p=>p.id===u.owner)?.name||'待分配';return `<button class="food-token" draggable="true" data-unit="${u.id}" aria-label="调整${esc(u.name)}，当前在${esc(owner)}">${productPicture(u)}<span>${esc(u.name)}</span></button>`;}
function renderTable() {
  $('#people').innerHTML=people.map((p,i)=>`<button class="person-pill" data-person="${p.id}">${avatar(p,i)}${esc(p.name)}<small>编辑</small></button>`).join('');
  $('#table').innerHTML=people.map((p,i)=>{const mine=units.filter(u=>u.owner===p.id);return `<article class="plate ${confirmed.includes(p.id)?'confirmed':''}" data-owner="${p.id}"><div class="plate-head"><div class="person-name">${avatar(p,i)}<strong>${esc(p.name)}</strong></div><span class="plate-number">PLATE 0${i+1}</span></div><div class="plate-foods">${mine.map(foodToken).join('')||'<div class="empty-plate">等一份<br>小快乐落在这里</div>'}</div><p class="plate-note">${mine.length?mine.length+' 份小快乐':'从待分配区点餐品，或拖到这里'}</p>${wishStatus(p)}<button class="confirm-button" data-confirm="${p.id}" ${mine.length?'':'disabled'}>${confirmed.includes(p.id)?'✓ 已记录确认':'记录餐盘确认'}</button></article>`;}).join('');
  const spare=units.filter(u=>!u.owner);$('#spare').innerHTML=`<div class="spare-tray" data-owner=""><div class="spare-label">待分配 · ${spare.length} 份<small>${units.length?'点餐品，选一位饭搭子。':'选好餐品后，会先来到这里。'}</small>${spare.length?'<button class="text-button" id="share-spare">剩下的，大家一起吃 →</button>':''}</div><div class="spare-foods">${spare.map(foodToken).join('')}</div></div>`;
  const shared=units.filter(u=>u.owner===SHARED_OWNER);$('#shared').innerHTML=`<div class="spare-tray shared-tray" data-owner="${SHARED_OWNER}"><div class="spare-label">大家一起吃 · ${shared.length} 份<small>薯条、小食，放这里一起分享。</small></div><div class="spare-foods">${shared.map(foodToken).join('')}</div></div>`;
  $('#table-status').textContent=`${units.length} 份餐品 · ${confirmed.length}/${people.length} 个餐盘已记录确认`;
  $('#assign-wishes').disabled=!units.length;$('#undo').disabled=!previous;$('#redistribute').disabled=!units.length;$('#add-person').disabled=people.length>=6;renderQuote();
  productImages.sync(state.store?.code,units.filter(u=>!u.image&&!menu?.products.some(p=>p.code===u.code&&p.image)).map(u=>u.code));
  renderJourney();
}
function move(id,owner) {const old=units.find(u=>u.id===id);if(!old||old.owner===owner||owner&&owner!==SHARED_OWNER&&!people.some(p=>p.id===owner))return;previous={units:clone(units),confirmed:[...confirmed]};units=units.map(u=>u.id===id?{...u,owner}:u);confirmed=confirmed.filter(p=>p!==owner&&p!==old.owner);renderTable();}
function showMove(id) {
  const u=units.find(u=>u.id===id);if(!u)return;
  const line=state.cart.find(c=>u.id.startsWith(c.id+'-'));
  openModal(head(`这份${u.name}，怎么安排？`)+`<p class="dialog-description">分给一个人，或留给大家一起吃。改归属不改变价格。</p><div class="destination-list">${people.map((p,i)=>`<button class="destination" data-move="${id}" data-to="${p.id}" ${u.owner===p.id?'disabled':''}>${avatar(p,i)}<strong>${esc(p.name)}</strong></button>`).join('')}<button class="destination" data-move="${id}" data-to="${SHARED_OWNER}" ${u.owner===SHARED_OWNER?'disabled':''}>大家一起吃</button><button class="destination" data-move="${id}" data-to="" ${u.owner?'':'disabled'}>先放待分配</button></div>${line?.detail.rounds.length?`<div class="dialog-actions"><button class="secondary" data-edit-line="${line.id}">换套餐搭配</button></div><p class="detail-body-note">来自 ${esc(line.name)}${line.quantity>1?` ×${line.quantity}；修改搭配会同时影响这 ${line.quantity} 份套餐`:''}。</p>`:''}`,'move');
}
function editPerson(id) {personDraft=id?people.find(p=>p.id===id):{id:`p${++sequence}`,name:'新搭子'};openModal(head('今天，怎么称呼你？')+`<label class="name-input-label">饭搭子的名字<input id="person-name" maxlength="12" value="${esc(personDraft.name)}"></label><p id="person-error" class="form-error" role="alert"></p><div class="dialog-actions">${id&&people.length>1?'<button class="danger-button" data-action="remove-person">这位今天不来了</button>':''}<button class="primary" data-action="save-person">保存名字</button></div>`,'person');}
function savePerson(remove=false) {const name=$('#person-name').value.trim();if(!remove&&(!name||people.some(p=>p.id!==personDraft.id&&p.name===name))){$('#person-error').textContent='请填写一个不重复的名字。';return;}
  if(remove){people=people.filter(p=>p.id!==personDraft.id);units=units.map(u=>u.owner===personDraft.id?{...u,owner:null}:u);}else if(people.some(p=>p.id===personDraft.id))people=people.map(p=>p.id===personDraft.id?{...p,name}:p);else if(people.length<6)people.push({...personDraft,name});
  confirmed=[];previous=null;closeModal();planner.invalidate();renderTable();}
function showShare(){if(!isQuoteCurrent(state)){renderQuote();return;}openModal(head('把这一桌，发给饭搭子')+`<p class="dialog-description">真实餐单保留门店、选配、核价时间与优惠条件。尚未下单。</p><textarea class="share-text live-share-text" id="share-text" aria-label="真实拼餐清单" readonly>${esc(makeShareText(state,people,units,confirmed))}</textarea><div class="dialog-actions"><button class="secondary" data-action="download">下载清单</button><button class="primary" data-action="copy">复制清单 ↗</button></div>`,'share');}

$('#store-form').addEventListener('submit',searchStores);$('#menu-search').addEventListener('input',renderMenu);
$('.brand').addEventListener('click',event=>{event.preventDefault();navigate('home');});
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.mode){navigate(null,b.dataset.mode);return;}
  if(b.dataset.view){navigate(b.dataset.view);return;}
  if(b.dataset.next){if(b.dataset.next==='table')navigate('table');else if(b.dataset.next==='share')showShare();else requestQuote();return;}
  if(b.dataset.store){chooseStore(b.dataset.store);return;}
  if(b.dataset.confirmStore){const code=b.dataset.confirmStore;closeModal();state.cart=[];chooseStore(code);return;}
  if(b.dataset.category!==undefined){category=Number(b.dataset.category);$('#menu-search').value='';renderMenu();return;}
  if(b.dataset.product){editProduct(b.dataset.product);return;}
  if(b.dataset.editLine){const line=state.cart.find(c=>c.id===b.dataset.editLine);editProduct(line.code,line.id);return;}
  if(b.dataset.removeLine){state.cart=state.cart.filter(c=>c.id!==b.dataset.removeLine);cartChanged();if(state.cart.length)requestQuote();return;}
  if(b.dataset.cartQuantity){const next=state.cart.map(c=>c.id===b.dataset.cartQuantity?{...c,quantity:Math.max(1,Math.min(6,c.quantity+Number(b.dataset.delta)))}:c);if(unitsForCart(next).length>60){notify('这一桌最多 60 份餐品。');return;}state.cart=next;cartChanged();scheduleQuote();return;}
  if(b.dataset.option&&draft){adjustChoice(b);return;}
  if(b.dataset.draftQuantity&&draft){draft.quantity=Math.max(1,Math.min(6,draft.quantity+Number(b.dataset.draftQuantity)));renderCounters();return;}
  if(b.dataset.unit){showMove(b.dataset.unit);return;}
  if(b.dataset.move){move(b.dataset.move,b.dataset.to||null);closeModal();return;}
  if(b.dataset.person){editPerson(b.dataset.person);return;}
  if(b.dataset.confirm){const id=b.dataset.confirm;confirmed=confirmed.includes(id)?confirmed.filter(p=>p!==id):[...confirmed,id];renderTable();return;}
  switch(b.dataset.action||b.id){
    case 'close':closeModal();break;
    case 'change-store':editingStore=!editingStore;renderJourney();if(editingStore)$('#keyword').focus();break;
    case 'replace-plan':{const next=pendingPlan;if(!next||next.storeCode!==state.store?.code||next.expiresAt<=Date.now()){closeModal();notify('方案已过期，请重新生成后选择。');return;}closeModal();applyPlan(next.cart);break;}
    case 'share-spare':previous={units:clone(units),confirmed:[...confirmed]};units=units.map(u=>u.owner?u:{...u,owner:SHARED_OWNER});renderTable();notify('剩下的餐品留给大家一起吃。');break;
    case 'save-dish':saveDish();break;
    case 'quote':requestQuote();break;
    case 'refresh-menu':loadMenu();break;
    case 'add-person':editPerson();break;
    case 'save-person':savePerson();break;
    case 'remove-person':savePerson(true);break;
    case 'assign-wishes':previous={units:clone(units),confirmed:[...confirmed]};units=assignWishes(units,people);confirmed=[];renderTable();notify('已按心愿分好，多出的可以留给大家一起吃。');break;
    case 'redistribute':previous={units:clone(units),confirmed:[...confirmed]};units=units.map((u,i)=>({...u,owner:people[i%people.length].id}));confirmed=[];renderTable();notify('轮流分好啦，还可以把喜欢的换给彼此。');break;
    case 'undo':if(previous){units=previous.units;confirmed=previous.confirmed;previous=null;renderTable();}break;
    case 'share':showShare();break;
    case 'copy':$('#share-text').value=makeShareText(state,people,units,confirmed);try{await navigator.clipboard.writeText($('#share-text').value);b.textContent='已复制 ✓';notify('真实餐单已复制');}catch{$('#share-text').focus();$('#share-text').select();b.textContent='请手动复制选中清单';notify('请按 ⌘C 或 Ctrl+C 复制选中的清单');}break;
    case 'download':{const url=URL.createObjectURL(new Blob([makeShareText(state,people,units,confirmed)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='套餐拼图-真实餐单.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break;}
    case 'help':openModal(head('两种玩法，一桌刚刚好')+'<ol class="help-list"><li>“帮我们拼一桌”：选择门店，填写每个人的心愿，选一桌推荐，自动按心愿分餐。</li><li>“我来挑，大家分”：选择门店，直接挑套餐和单品，再点“选好了，分给大家”。无需填写心愿。</li><li>两种玩法共用这一桌。换玩法保留餐品与归属；选用新方案替换前会请你确认。</li><li>点餐盘里的餐品，可改归属、放到“大家一起吃”或换套餐搭配。</li><li>改餐自动核价，分餐不改变价格。核对后即可复制或下载餐单，报价过期时重新核价。</li></ol><p class="help-foot">当前支持到店自取、门店默认特调；不附加购卡或指定优惠券，也不创建订单。刷新会清空当前餐桌。</p>','help');break;
  }
});
document.addEventListener('dragstart',e=>{const t=e.target.closest('[data-unit]');if(t){e.dataTransfer.setData('text/plain',t.dataset.unit);e.dataTransfer.effectAllowed='move';t.classList.add('dragging');}});
document.addEventListener('dragend',()=>document.querySelectorAll('.dragging,.drag-over').forEach(e=>e.classList.remove('dragging','drag-over')));
document.addEventListener('dragover',e=>{const t=e.target.closest('[data-owner]');if(t){e.preventDefault();t.classList.add('drag-over');}});
document.addEventListener('dragleave',e=>{const t=e.target.closest('[data-owner]');if(t&&!t.contains(e.relatedTarget))t.classList.remove('drag-over');});
document.addEventListener('drop',e=>{const t=e.target.closest('[data-owner]');if(t){e.preventDefault();t.classList.remove('drag-over');move(e.dataTransfer.getData('text/plain'),t.dataset.owner||null);}});
window.addEventListener('pagehide',()=>productImages.sync(null,[]));
window.addEventListener('pageshow',event=>{if(event.persisted)renderTable();});
function wishStatus(person) {
  if(journey.mode!=='wishes')return '';
  const status=personWishStatus(units,person);
  if(!status.wanted)return '';
  const missing=status.missing.map(c=>`${WISH_KINDS.find(k=>k.id===c.kind).name} ×${c.quantity}`).join('、');
  return `<p class="plate-wish-status ${missing?'pending-wish':''}">心愿 ${status.matched}/${status.wanted}${missing?' · 还缺 '+esc(missing):' · 刚刚好 ✓'}</p>`;
}
function applyPlan(cart) {
  state.cart=cart.map(c=>({...c,id:`l${++sequence}`,storeCode:state.store.code}));cartChanged();units=assignWishes(units,people);navigate('table');requestQuote();notify('已按心愿分好，正在核清这桌的最新价格。');
}
const planner=createWishPlanner({getPeople:()=>people,getStore:()=>state.store,getMenu:()=>menu,hasMenu:()=>Boolean(menu),hasCart:()=>Boolean(state.cart.length),api,cancel:()=>controllers.get('plans')?.abort(),onChange:renderTable,picture:productPicture,escape:esc,onApply:(cart,context)=>{
  if(!state.cart.length){applyPlan(cart);return;}
  pendingPlan={cart,...context};
  openModal(head('换成这桌推荐？')+'<p class="dialog-description">当前餐品和分配将替换为新方案，并重新按心愿分好。取消可继续保留现在这一桌。</p><div class="dialog-actions"><button class="secondary" data-action="close">保留当前这一桌</button><button class="primary" data-action="replace-plan">换成推荐并核价</button></div>','replace');
}});
planner.render();
$('#hero-burger').innerHTML=foodArt('beef');$('#hero-fries').innerHTML=foodArt('fries');$('#hero-coffee').innerHTML=foodArt('coffee');renderCart();renderTable();
try{const status=await api('status',null,'status');configured=status.configured;if(configured&&journey.mode&&!stores.length)searchStores();else if(!configured){$('#connection-status').textContent='连接待配置';$('#store-error').textContent='真实菜单连接尚未配置，请联系站点主人。';$('#mode-note').textContent='真实菜单连接尚未配置，可从页脚进入趣味演示。';}}
catch(e){$('#connection-status').textContent='连接暂不可用';$('#store-error').textContent=e.message;$('#mode-note').textContent=e.message;}
