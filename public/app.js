import { FOODS, SCENARIOS, solve, distribute, needsFor, moveUnit, shareText, money, demandFor } from './engine.js';
import { foodArt } from './art.js';
const $ = s => document.querySelector(s);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = x => JSON.parse(JSON.stringify(x));
const tones = [['#f7dfcc','#b87847'],['#dce8eb','#5e858c'],['#e4e9d5','#7d8c56'],['#f1dfe1','#b47c81'],['#e7dff0','#8e74a5'],['#f3e9c9','#ac9858']];
let people = clone(SCENARIOS[0].people), mode = 'exact', plan, units = [], confirmed = [], previous = null, toastTimer;
let scenarioIndex = 0, counter = 10, draft, lastFocused;
const dialog = $('#dialog');
const foodName = id => FOODS.find(f => f.id === id).short;
const tone = i => `--person-soft:${tones[i % tones.length][0]};--person-ink:${tones[i % tones.length][1]}`;
const avatar = (p,i) => `<span class="avatar" style="${tone(i)}">${escape(Array.from(p.name)[0] || '友')}</span>`;
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800); }
function modal(html) { lastFocused = document.activeElement; $('#dialog-content').innerHTML = html; if (!dialog.open) dialog.showModal(); }
function close() { dialog.close(); lastFocused?.isConnected && lastFocused.focus(); }
const head = title => `<div class="dialog-head"><h2>${title}</h2><button class="close-dialog" data-action="close" aria-label="关闭弹窗">×</button></div>`;
dialog.addEventListener('click', e => { if(e.target === dialog) { const r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) close(); } });
function recompute(message) {
  plan = solve(people, mode); units = distribute(plan, people); confirmed = []; previous = null; render();
  if (message) notify(message);
}
function render() {
  $('#people-count').textContent = `${people.length} 位搭子`;
  $('#people').innerHTML = people.map((p,i) => `<article class="person-wish"><div class="wish-heading"><div class="person-name">${avatar(p,i)}<strong>${escape(p.name)}</strong></div><button class="edit-button" data-edit="${p.id}" aria-label="编辑${escape(p.name)}的口味">编辑 ↗</button></div><div class="wish-chips">${FOODS.filter(f => p.wants[f.id]).map(f => `<span class="wish-chip">${foodArt(f.id)}${f.short}<b>×${p.wants[f.id]}</b></span>`).join('') || '<span class="empty-wish">还没选，点编辑许个愿</span>'}</div></article>`).join('');
  $('#add-person').disabled = people.length >= 6;
  document.querySelectorAll('[data-mode]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.mode === mode)));
  $('#plan').innerHTML = plan.bundles.length ? `<div class="bundles">${plan.bundles.map(b => `<article class="bundle"><div class="bundle-head"><h3>${b.name}</h3><span class="qty">× ${b.quantity}</span></div><div class="bundle-art">${Object.entries(b.items).flatMap(([id,q]) => Array.from({length:q}, () => foodArt(id))).join('')}</div><p class="bundle-desc">${Object.entries(b.items).map(([id,q])=>`${foodName(id)}${q>1?' ×'+q:''}`).join(' · ')}</p><div class="bundle-price">¥${money(b.price*b.quantity)}</div></article>`).join('')}</div><div class="price-summary"><div><div class="price-label">这一桌的示例合计</div><div class="price-total"><small>¥</small>${money(plan.cost)}</div><div class="price-before">同样需求分别单点 ¥${money(plan.baseline)}</div></div><div class="saving">${plan.saving>0 ? `示例少花 <b>¥${money(plan.saving)}</b>` : '每个人，各取所爱'}</div></div>${plan.extraCount ? `<div class="excess-note">✳ 这份组合比原需求多 ${plan.extraCount} 份餐品，已放入分享区。请确认有人想吃，也可以切回「刚刚好」。</div>` : '<p class="plan-note">✓ 按演示菜单计算，购买数量与大家的需求刚好一致。</p>'}` : '<div class="empty-plan">先给餐盘许个愿吧。<br>至少选择一份餐品，我们就开始拼。</div>';
  renderTable();
}
function token(u) { const owner = people.find(p => p.id === u.owner)?.name || '分享区'; return `<button class="food-token" draggable="true" data-unit="${u.id}" aria-label="移动${foodName(u.foodId)}，当前在${escape(owner)}">${foodArt(u.foodId)}<span>${foodName(u.foodId)}</span></button>`; }
function renderTable() {
  $('#table').innerHTML = people.map((p,i) => {
    const mine = units.filter(u => u.owner === p.id), needs = needsFor(p,units), missing = needs.filter(n => n.missing), extra = needs.filter(n=>n.extra);
    const note = missing.length ? `还差 ${missing.map(n=>`${foodName(n.foodId)}×${n.missing}`).join('、')}` : extra.length ? `多了 ${extra.map(n=>`${foodName(n.foodId)}×${n.extra}`).join('、')}，喜欢就留下` : mine.length ? '想吃的，都在这里了' : '还没有选择餐品';
    return `<article class="plate ${confirmed.includes(p.id)?'confirmed':''}" data-owner="${p.id}"><div class="plate-head"><div class="person-name">${avatar(p,i)}<strong>${escape(p.name)}</strong></div><span class="plate-number">PLATE 0${i+1}</span></div><div class="plate-foods">${mine.map(token).join('') || '<div class="empty-plate">等一份<br>小快乐落在这里</div>'}</div><p class="plate-note ${missing.length?'missing':''}">${note}</p><button class="confirm-button" data-confirm="${p.id}" ${missing.length || !mine.length ? 'disabled' : ''} aria-label="${confirmed.includes(p.id)?'取消':'记录'}${escape(p.name)}的餐盘确认">${confirmed.includes(p.id)?'✓ 已记录确认':'记录餐盘确认'}</button></article>`;
  }).join('');
  const spare = units.filter(u => !u.owner);
  $('#spare').innerHTML = spare.length ? `<div class="spare-tray" data-owner=""><div class="spare-label">✳ 分享区 · ${spare.length} 份<small>谁刚好想吃？点一下，送到他的餐盘。</small></div><div class="spare-foods">${spare.map(token).join('')}</div></div>` : '<div class="empty-spare" data-owner="">♡ 每份餐品都有了归属 · 也可以拖到这里，重新分配。</div>';
  const missingCount = people.reduce((sum,p) => sum + needsFor(p,units).reduce((s,n)=>s+n.missing,0),0);
  $('#table-status').textContent = `${units.length} 份餐品 · ${confirmed.length}/${people.length} 个餐盘已记录确认${missingCount?' · 还有 '+missingCount+' 份待补':''}`;
  $('#undo').disabled = !previous;
  $('#redistribute').disabled = !units.length;
  $('#share').disabled = !units.length;
  const ready = people.length && confirmed.length === people.length && !missingCount && !spare.length;
  $('#finish-title').textContent = ready ? '这一桌的小快乐，全部到位。' : '这一桌，准备好了吗？';
  $('#finish-detail').textContent = ready ? '已在本机完成核对，可以把演示清单分享给饭搭子。' : '由你记录餐盘确认；有待补或待分配时，清单会如实标注。';
}
function editPerson(id, isNew = false) {
  const p = isNew ? {id:`p${++counter}`,name:'新搭子',wants:{}} : people.find(p=>p.id===id);
  draft = {...clone(p), isNew};
  modal(head(isNew?'新饭搭子，欢迎入座':'给今天许个小愿望')+`<p class="dialog-description">只选自己想吃的。每种最多 3 份，整桌最多 20 份。</p><label class="name-input-label">怎么称呼你<input id="person-name" maxlength="12" value="${escape(p.name)}" autocomplete="off"></label><div class="food-picker">${FOODS.map(f=>`<div class="picker-item">${foodArt(f.id)}<div><strong>${f.short}</strong><div class="counter"><button data-count="${f.id}" data-delta="-1" aria-label="减少${f.short}">−</button><span id="count-${f.id}">${p.wants[f.id]||0}</span><button data-count="${f.id}" data-delta="1" aria-label="增加${f.short}">＋</button></div></div></div>`).join('')}</div><p class="form-error" id="form-error" role="alert"></p><div class="dialog-actions">${!isNew&&people.length>1?'<button class="danger-button" data-action="remove-person">这位今天不点了</button>':''}<button class="primary" data-action="save-person">${isNew?'加入这一桌':'保存，重新拼一桌'} →</button></div>`);
}
function savePerson(remove = false) {
  const name = $('#person-name').value.trim();
  if (!remove && !name) { $('#form-error').textContent='先给饭搭子起个名字吧。'; return; }
  if (!remove && people.some(p=>p.id!==draft.id&&p.name===name)) { $('#form-error').textContent='这桌已经有这个名字了，请加个称呼来区分。'; return; }
  const updated = {...draft,name}; delete updated.isNew;
  const next = remove ? people.filter(p=>p.id!==draft.id) : draft.isNew ? [...people,updated] : people.map(p=>p.id===draft.id?updated:p);
  const total=demandFor(next);
  if(total.some(n=>n>8)||total.reduce((a,b)=>a+b,0)>20){$('#form-error').textContent='这桌最多 20 份，每种最多 8 份；稍微调整一下吧。';return;}
  people=next; close(); recompute(remove?'已移除，并重新计算这桌组合':'口味已更新，餐盘需要重新核对');
}
function showMove(id) {
  const u=units.find(u=>u.id===id); if(!u)return;
  modal(head(`这份${foodName(u.foodId)}，给谁？`)+`<div class="move-preview">${foodArt(u.foodId)}</div><p class="dialog-description">移动的是已在这桌里的餐品，不会额外购买。受影响的餐盘需要重新核对。</p><div class="destination-list">${people.map((p,i)=>{
    const need=needsFor(p,units).find(n=>n.foodId===u.foodId)?.missing||0;
    return `<button class="destination" data-move="${u.id}" data-to="${p.id}" ${u.owner===p.id?'disabled':''}>${avatar(p,i)}<span><strong>${escape(p.name)}</strong><small>${u.owner===p.id?'已经在这个餐盘':need?'刚好还想要 '+need+' 份':'原需求已满足，作为额外分享'}</small></span></button>`;
  }).join('')}<button class="destination" data-move="${u.id}" data-to="" ${!u.owner?'disabled':''}><span>✳</span><span><strong>先放分享区</strong><small>等想吃的人来认领</small></span></button></div>`);
}
function move(id,owner) {
  const old=units.find(u=>u.id===id); if(!old||old.owner===owner)return;
  previous={units:clone(units),confirmed:[...confirmed]};
  units=moveUnit(units,id,owner,people);confirmed=confirmed.filter(p=>p!==old.owner&&p!==owner);renderTable();
  const destination = owner ? `${people.find(p=>p.id===owner).name}的餐盘` : '分享区';
  notify(`这份${foodName(old.foodId)}已放到${destination}`);
}
function share() { modal(head('把小快乐，发给饭搭子')+`<p class="dialog-description">清单会保留演示标记、待补餐品和未确认状态。确认由你在本机记录。</p><textarea class="share-text" id="share-text" readonly aria-label="演示拼餐清单">${escape(shareText(plan,people,units,confirmed))}</textarea><div class="dialog-actions"><button class="secondary" data-action="download">下载清单</button><button class="primary" data-action="copy">复制清单 ↗</button></div>`); }
function chooseScenario(){modal(head('今天，想和谁一起吃？')+'<p class="dialog-description">选择一桌示例，会替换当前口味与分配。也可以关闭后继续当前餐桌。</p><div class="scenario-list">'+SCENARIOS.map((s,i)=>`<button class="scenario-option" data-scenario="${i}"><b>${s.name} · ${s.people.length} 人</b><span>${s.caption}</span></button>`).join('')+'</div>');}
$('#hero-burger').innerHTML=foodArt('beef');$('#hero-fries').innerHTML=foodArt('fries');$('#hero-coffee').innerHTML=foodArt('coffee');
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.edit){editPerson(b.dataset.edit);return;}
  if(b.dataset.mode){if(mode===b.dataset.mode)return;mode=b.dataset.mode;recompute('已更新组合，餐盘已按原需求重新分好');return;}
  if(b.dataset.unit){showMove(b.dataset.unit);return;}
  if(b.dataset.confirm){const id=b.dataset.confirm;confirmed=confirmed.includes(id)?confirmed.filter(p=>p!==id):[...confirmed,id];renderTable();return;}
  if(b.dataset.count){const id=b.dataset.count;draft.wants[id]=Math.max(0,Math.min(3,(draft.wants[id]||0)+Number(b.dataset.delta)));$('#count-'+id).textContent=draft.wants[id];return;}
  if(b.dataset.move){move(b.dataset.move,b.dataset.to||null);close();return;}
  if(b.dataset.scenario!==undefined){scenarioIndex=Number(b.dataset.scenario);people=clone(SCENARIOS[scenarioIndex].people);mode='exact';close();recompute('新饭搭子已入座');return;}
  switch(b.dataset.action||b.id){
    case 'close':close();break;
    case 'add-person':editPerson(null,true);break;
    case 'save-person':savePerson();break;
    case 'remove-person':savePerson(true);break;
    case 'redistribute':previous={units:clone(units),confirmed:[...confirmed]};units=distribute(plan,people);confirmed=[];renderTable();notify('已按每个人的愿望重新分好');break;
    case 'undo':if(previous){units=previous.units;confirmed=previous.confirmed;previous=null;renderTable();notify('已撤销上次分配');}break;
    case 'share':share();break;
    case 'copy':try{await navigator.clipboard.writeText($('#share-text').value);notify('演示清单已复制');}catch{$('#share-text').focus();$('#share-text').select();notify('请按 ⌘C 或 Ctrl+C 复制选中的清单');}break;
    case 'download':{const url=URL.createObjectURL(new Blob([$('#share-text').value],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='套餐拼图-演示清单.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break;}
    case 'scenario-button':chooseScenario();break;
    case 'reset':modal(head('重新摆好这一桌？')+'<p class="dialog-description">将恢复最初三位饭搭子的口味，清除当前分配与确认记录。</p><div class="dialog-actions"><button class="secondary" data-action="close">继续这一桌</button><button class="primary" data-action="confirm-reset">恢复初始餐桌</button></div>');break;
    case 'confirm-reset':people=clone(SCENARIOS[0].people);mode='exact';scenarioIndex=0;close();recompute('初始餐桌已恢复');break;
    case 'help':modal(head('把一桌口味，拼在一起')+'<ol class="help-list"><li><b>每个人许个愿。</b>编辑口味卡，选择自己想吃的餐品。</li><li><b>找到合适的组合。</b>「刚刚好」不多买；「预算优先」会显示多出来的餐品。</li><li><b>把快乐分到餐盘。</b>拖动餐品，或点一下选择归属；移动后可撤销。</li><li><b>核对后分享。</b>记录每个餐盘的确认状态，再复制或下载清单。</li></ol><p class="help-foot">当前是独立演示版，所有菜单、套餐和价格均为虚构。没有连接麦当劳 MCP，也不会下单或支付。操作仅在当前页面内有效，刷新后恢复初始餐桌。餐盘确认由本机操作者记录。</p>');break;
  }
});
document.addEventListener('dragstart',e=>{const token=e.target.closest('[data-unit]');if(!token)return;e.dataTransfer.setData('text/plain',token.dataset.unit);e.dataTransfer.effectAllowed='move';token.classList.add('dragging');});
document.addEventListener('dragend',()=>{document.querySelectorAll('.dragging,.drag-over').forEach(el=>el.classList.remove('dragging','drag-over'));});
document.addEventListener('dragover',e=>{const target=e.target.closest('[data-owner]');if(target){e.preventDefault();e.dataTransfer.dropEffect='move';target.classList.add('drag-over');}});
document.addEventListener('dragleave',e=>{const target=e.target.closest('[data-owner]');if(target&&!target.contains(e.relatedTarget))target.classList.remove('drag-over');});
document.addEventListener('drop',e=>{const target=e.target.closest('[data-owner]');if(!target)return;e.preventDefault();const id=e.dataTransfer.getData('text/plain');target.classList.remove('drag-over');if(units.some(u=>u.id===id))move(id,target.dataset.owner||null);});
recompute();
