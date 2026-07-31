'use strict';

const CONFIG_DEFAULT = { bossName:'피즐리베어', maxHp:33000, minDamage:1, maxDamage:1500, multiCount:11, shotInterval:240, apiEnabled:true, guideEnabled:true };
let config = {...CONFIG_DEFAULT};
let currentHp = config.maxHp;
let dead = false;
let shotQueue = Promise.resolve();
let combo = 0;
let comboTimer = null;
let currentPhase = 1;
let phaseNoticeTimer = null;
let totalHitCount = 0;

let attackerStats = {}; 
let remainingQueue = []; 

const $ = s => document.querySelector(s);
const game=$('#game'), hpFill=$('#hpFill'), hpLag=$('#hpLag'), currentHpEl=$('#currentHp'), maxHpEl=$('#maxHp'), hpPercent=$('#hpPercent');
const boss=$('#boss'), bombing=$('#bombing'), muzzle=$('#muzzle'), fxLayer=$('#fxLayer'), dangerBanner=$('#dangerBanner');
const attackBtn=$('#attackBtn'), multiBtn=$('#multiBtn'), lastAttack=$('#lastAttack'), winnerScreen=$('#winnerScreen');
const armorStatus=$('#armorStatus'), phaseNotice=$('#phaseNotice'), phaseNoticeIcon=$('#phaseNoticeIcon'), phaseNoticeTitle=$('#phaseNoticeTitle'), phaseNoticeBossText=$('#phaseNoticeBossText'), phaseNoticeDefenseText=$('#phaseNoticeDefenseText');
const damageLog=$('#damageLog'), jackpotNotice=$('#jackpotNotice');
const MAX_DAMAGE_LOGS=10;
let damageLogSequence=0;
let jackpotNoticeTimer=null;

const SPRITES={ bombingIdle:'assets/bombing_idle.png', bombingAttack:'assets/bombing_attack.png', bombingShoot:'assets/bombing_shoot.png', bossIdle:'assets/pizzlybear_idle.png', bossHit:'assets/pizzlybear_hit.png', bossDead:'assets/pizzlybear_die.png' };
function setSprite(el,src){ if(el.getAttribute('src')!==src) el.setAttribute('src',src); }

function loadSettings(){ try{ const saved=JSON.parse(localStorage.getItem('pizzlyRaidConfig')); if(saved) config={...config,...saved}; }catch{} syncInputs(); }
function syncInputs(){ 
  $('#bossNameInput').value=config.bossName; 
  $('#maxHpInput').value=config.maxHp; 
  $('#minDamageInput').value=config.minDamage; 
  $('#maxDamageInput').value=config.maxDamage; 
  $('#multiCountInput').value=config.multiCount; 
  $('#shotIntervalInput').value=config.shotInterval; 
  $('#bossName').textContent=config.bossName; 

  const apiToggle = $('#apiEnabledInput');
  const apiStatusText = $('#apiStatusText');
  if (apiToggle) {
    apiToggle.checked = config.apiEnabled !== false;
    if(apiStatusText) {
      apiStatusText.textContent = apiToggle.checked ? 'ON (작동 중)' : 'OFF (차단됨)';
      apiStatusText.style.color = apiToggle.checked ? '#ffea00' : '#ff3333';
    }
  }
}
function saveSettings(){ localStorage.setItem('pizzlyRaidConfig',JSON.stringify(config)); }

function getPhaseByPercent(pct){
  if(pct<=0) return 0;
  if(pct<=30) return 3;
  if(pct<=50) return 2;
  return 1;
}

function getDefenseRate(){
  const hpRatio=currentHp/config.maxHp;
  if(hpRatio<=0.30) return 0.15;
  if(hpRatio<=0.50) return 0.10;
  return 0;
}

function applyBossDefense(damage){
  const rate=getDefenseRate();
  return Math.max(1,Math.floor(damage*(1-rate)));
}

function phaseAlertSound(finalPhase=false){
  try{
    const c=audio(),t=c.currentTime;
    const osc=c.createOscillator(),gain=c.createGain();
    osc.type=finalPhase?'sawtooth':'triangle';
    osc.frequency.setValueAtTime(finalPhase?180:420,t);
    osc.frequency.exponentialRampToValueAtTime(finalPhase?70:720,t+.28);
    gain.gain.setValueAtTime(finalPhase?.15:.10,t);
    gain.gain.exponentialRampToValueAtTime(.001,t+.42);
    osc.connect(gain).connect(c.destination);
    osc.start(t);osc.stop(t+.45);
  }catch{}
}

function showPhaseNotice(phase){
  clearTimeout(phaseNoticeTimer);

  const finalPhase=phase===3;
  phaseNoticeIcon.textContent=finalPhase?'☠':'⚠';
  phaseNoticeTitle.textContent=finalPhase?'FINAL PHASE':'PHASE 2';
  phaseNoticeBossText.textContent=finalPhase
    ? `${config.bossName}가 광폭화했습니다.`
    : `${config.bossName}가 분노했습니다.`;
  phaseNoticeDefenseText.textContent=finalPhase
    ? '방어력이 5% 더 증가합니다. (현재 총 +15%)'
    : '방어력이 10% 증가합니다.';

  phaseNotice.classList.remove('show','phase2','final');
  phaseNotice.classList.add(finalPhase?'final':'phase2');
  phaseNotice.setAttribute('aria-hidden','false');
  void phaseNotice.offsetWidth;
  phaseNotice.classList.add('show');

  restartAnimation(game,'heavy-shake');
  restartAnimation($('#phaseFlash'),'on');
  phaseAlertSound(finalPhase);

  phaseNoticeTimer=setTimeout(()=>{
    phaseNotice.classList.remove('show');
    phaseNotice.setAttribute('aria-hidden','true');
  },2600);
}

function updateHp(next){
  currentHp=Math.max(0,Math.min(config.maxHp,Math.round(next)));
  const pct=currentHp/config.maxHp*100;
  const nextPhase=getPhaseByPercent(pct);

  hpFill.style.width=`${pct}%`;
  hpLag.style.width=`${pct}%`;
  currentHpEl.textContent=currentHp.toLocaleString();
  maxHpEl.textContent=config.maxHp.toLocaleString();
  hpPercent.textContent=`${pct.toFixed(pct<10?1:0)}%`;

  hpFill.classList.toggle('low',pct<=20 && pct>0);
  dangerBanner.classList.toggle('show',pct<=20 && pct>0);

  $('#phaseText').textContent=
    nextPhase===3?'FINAL PHASE':
    nextPhase===2?'PHASE 2':
    nextPhase===1?'PHASE 1':'DEFEATED';

  armorStatus.classList.remove('active','final');
  if(nextPhase===3){
    armorStatus.textContent='🛡 DEF +15%';
    armorStatus.classList.add('active','final');
  }else if(nextPhase===2){
    armorStatus.textContent='🛡 DEF +10%';
    armorStatus.classList.add('active');
  }else{
    armorStatus.textContent='🛡 DEF +0%';
  }

  boss.classList.toggle('phase2',nextPhase===2);
  boss.classList.toggle('final-phase',nextPhase===3);
  game.classList.toggle('phase2-active',nextPhase===2);
  game.classList.toggle('final-phase-active',nextPhase===3);

  if(nextPhase>currentPhase && currentPhase>0){
    showPhaseNotice(nextPhase);
  }

  currentPhase=nextPhase;
}

function randomInt(min,max){
  const low=Math.ceil(Math.min(min,max));
  const high=Math.floor(Math.max(min,max));
  return Math.floor(Math.random()*(high-low+1))+low;
}

function randomDamage(){
  const min=config.minDamage;
  const max=config.maxDamage;
  const roll=Math.random();
  const lowUpper=Math.max(min,Math.floor(max*0.10));

  if(roll<0.03){
    return { damage:0, type:'miss' };
  }
  if(roll<0.08){
    return { damage:randomInt(min,lowUpper), type:'weak' };
  }
  if(roll<0.97){
    const normalMin=Math.min(max,lowUpper+1);
    const damage=randomInt(normalMin,max);
    return { damage, type:damage>=max*0.85?'critical':'normal' };
  }
  return { damage:randomInt(max+1,max*4), type:'jackpot' };
}

function clearDamageLog(){
  damageLogSequence=0;
  damageLog.innerHTML='<div class="damage-log-empty">공격 대기 중</div>';
}

function addDamageLog(type, damage=0, nickname='익명의 시청자'){
  const empty=damageLog.querySelector('.damage-log-empty');
  if(empty) empty.remove();

  damageLogSequence+=1;
  const row=document.createElement('div');
  row.className=`damage-log-row ${type}`;

  const index=document.createElement('span');
  index.className='damage-log-index';
  index.textContent=String(damageLogSequence).padStart(2,'0');

  const nickEl=document.createElement('span');
  nickEl.className='damage-log-nick';
  nickEl.textContent=nickname;
  nickEl.style.cssText='color: #ffea00; font-weight: bold; max-width: 75px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px;';

  const label=document.createElement('strong');
  label.className='damage-log-value';

  const badge=document.createElement('em');
  badge.className='damage-log-badge';

  if(type==='miss'){
    label.textContent='MISS';
    badge.textContent='빗나감';
  }else{
    label.textContent=`-${Number(damage).toLocaleString()}`;
    badge.textContent=
      type==='jackpot'?'JACKPOT':
      type==='critical'?'CRITICAL':
      type==='weak'?'WEAK':'HIT';
  }

  row.append(index, nickEl, label, badge);
  damageLog.appendChild(row);

  while(damageLog.children.length>MAX_DAMAGE_LOGS){
    damageLog.firstElementChild.remove();
  }

  [...damageLog.querySelectorAll('.damage-log-row')].forEach((item,i)=>{
    const visibleIndex=item.querySelector('.damage-log-index');
    if(visibleIndex) visibleIndex.textContent=String(i+1).padStart(2,'0');
  });

  damageLog.scrollTop=damageLog.scrollHeight;
}

function jackpotSound(){
  try{
    const c=audio(),t=c.currentTime;
    [220,330,440,660].forEach((freq,i)=>{
      const o=c.createOscillator(),g=c.createGain();
      o.type=i%2?'square':'sawtooth';
      o.frequency.setValueAtTime(freq,t+i*.035);
      o.frequency.exponentialRampToValueAtTime(freq*1.7,t+.42+i*.035);
      g.gain.setValueAtTime(.001,t);
      g.gain.linearRampToValueAtTime(.075,t+i*.035+.02);
      g.gain.exponentialRampToValueAtTime(.001,t+.5+i*.035);
      o.connect(g).connect(c.destination);
      o.start(t+i*.035);
      o.stop(t+.55+i*.035);
    });
  }catch{}
}

function showJackpotNotice(){
  clearTimeout(jackpotNoticeTimer);
  jackpotNotice.classList.remove('show');
  jackpotNotice.setAttribute('aria-hidden','false');
  void jackpotNotice.offsetWidth;
  jackpotNotice.classList.add('show');
  restartAnimation(game,'heavy-shake');
  restartAnimation($('#phaseFlash'),'on');
  jackpotSound();

  jackpotNoticeTimer=setTimeout(()=>{
    jackpotNotice.classList.remove('show');
    jackpotNotice.setAttribute('aria-hidden','true');
  },1450);
}

let audioCtx=null;
function audio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function gunSound(){ try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain(),n=c.createBufferSource(),b=c.createBuffer(1,c.sampleRate*.08,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);n.buffer=b;o.type='square';o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(55,t+.08);g.gain.setValueAtTime(.12,t);g.gain.exponentialRampToValueAtTime(.001,t+.1);o.connect(g);n.connect(g);g.connect(c.destination);o.start(t);n.start(t);o.stop(t+.1)}catch{}}
function hitSound(big=false){try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type='sawtooth';o.frequency.setValueAtTime(big?90:160,t);o.frequency.exponentialRampToValueAtTime(38,t+.15);g.gain.setValueAtTime(big?.18:.08,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);o.connect(g).connect(c.destination);o.start();o.stop(t+.2)}catch{}}
function missSound(){try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(900,t);o.frequency.exponentialRampToValueAtTime(260,t+.22);g.gain.setValueAtTime(.055,t);g.gain.exponentialRampToValueAtTime(.001,t+.24);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.25)}catch{}}

function restartAnimation(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls)}
function screenShake(heavy=false){restartAnimation(game,heavy?'heavy-shake':'shake')}
function addCombo(){combo++;$('#comboCount').textContent=combo;$('#combo').classList.add('show');clearTimeout(comboTimer);comboTimer=setTimeout(()=>{combo=0;$('#combo').classList.remove('show')},1200)}
function sparks(x,y,count=8){for(let i=0;i<count;i++){const s=document.createElement('i');s.className='spark';s.style.left=`${x}px`;s.style.top=`${y}px`;const a=Math.random()*Math.PI*2,r=35+Math.random()*75;s.style.setProperty('--dx',`${Math.cos(a)*r}px`);s.style.setProperty('--dy',`${Math.sin(a)*r}px`);s.style.setProperty('--rot',`${Math.random()*360}deg`);fxLayer.appendChild(s);setTimeout(()=>s.remove(),550)}}

function muzzleBurst(x,y){
  const burst=document.createElement('div');
  burst.className='muzzle-burst';
  burst.style.left=`${x}px`;
  burst.style.top=`${y}px`;

  const ring=document.createElement('div');
  ring.className='muzzle-ring';
  ring.style.left=`${x}px`;
  ring.style.top=`${y}px`;

  const flash=document.createElement('div');
  flash.className='shot-flash';

  fxLayer.appendChild(burst);
  fxLayer.appendChild(ring);
  game.appendChild(flash);

  for(let i=0;i<7;i++){
    const p=document.createElement('i');
    p.className='muzzle-particle';
    p.style.left=`${x}px`;
    p.style.top=`${y}px`;
    p.style.setProperty('--mx',`${35+Math.random()*95}px`);
    p.style.setProperty('--my',`${(Math.random()-.5)*70}px`);
    p.style.setProperty('--mr',`${(Math.random()-.5)*90}deg`);
    fxLayer.appendChild(p);
    setTimeout(()=>p.remove(),300);
  }

  setTimeout(()=>burst.remove(),260);
  setTimeout(()=>ring.remove(),320);
  setTimeout(()=>flash.remove(),130);
}

function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

const centerLog = $('#centerLog');

function showDamagePopup(nickname, actualDamage, type) {
  if (dead) return;

  const safeName = nickname || '익명의 시청자';
  
  let color = '#ffea00';      
  let shadow = '#ff6a00';
  let scale = 'scale(1)';
  let displayText = `🔥 ${actualDamage.toLocaleString()} 데미지!`;

  if (type === 'miss' || actualDamage <= 0) {
    color = '#ff3333';
    shadow = '#880000';
    displayText = `❌ MISS!`;
  } else if (type === 'jackpot') {
    color = '#ff00ea';
    shadow = '#7b00ff';
    scale = 'scale(1.25)';
    displayText = `💥 [초대박!] ${actualDamage.toLocaleString()} 데미지!`;
  } else if (type === 'critical') {
    color = '#ff5500';
    shadow = '#ff0000';
    scale = 'scale(1.12)';
    displayText = `⚡ [크리티컬] ${actualDamage.toLocaleString()} 데미지!`;
  } else if (type === 'weak') {
    color = '#b0b0b0';
    shadow = '#333333';
    displayText = `💤 약함 (${actualDamage.toLocaleString()})`;
  } else {
    color = '#ffea00';
    shadow = '#ff6a00';
    displayText = `🔥 ${actualDamage.toLocaleString()} 데미지!`;
  }

  centerLog.innerHTML = `
    <span class="cl-nick" style="font-size: clamp(22px, 2.8vw, 38px); color: #fff; text-shadow: 2px 2px 0 #000;">${safeName}</span>
    <span class="cl-amount" style="font-size: clamp(28px, 3.8vw, 58px); color: ${color}; text-shadow: 0 0 15px ${shadow}, 2px 2px 0 #000; transform: ${scale}; display: inline-block; transition: transform 0.1s;">${displayText}</span>
  `;

  centerLog.classList.add('show');

  setTimeout(() => {
    centerLog.classList.remove('show');
  }, Math.max(config.shotInterval * 1.2, 600));
}

async function animateShot(result, attacker){
  const {damage,type}=result;
  if(dead)return;

  totalHitCount++;

  if (!attackerStats[attacker]) {
    attackerStats[attacker] = { totalDamage: 0, hitCount: 0, missCount: 0, critCount: 0, jackpotCount: 0, maxHitDamage: 0 };
  }
  attackerStats[attacker].hitCount++;

  const isMiss=type==='miss';
  const gw=game.clientWidth,gh=game.clientHeight;
  const startX=gw*.275,startY=gh*(.515+Math.random()*.035);

  const hitX=isMiss
    ? gw*(.91+Math.random()*.07)
    : gw*(.74+Math.random()*.09);
  const hitY=isMiss
    ? gh*(Math.random()<.5 ? .28+Math.random()*.10 : .70+Math.random()*.09)
    : gh*(.43+Math.random()*.22);

  setSprite(bombing,SPRITES.bombingAttack);
  await wait(160);
  if(dead)return;

  setSprite(bombing,SPRITES.bombingShoot);
  restartAnimation(bombing,'fire');
  restartAnimation(muzzle,'on');
  gunSound();
  muzzleBurst(startX,startY);
  screenShake(false);

  const bullet=document.createElement('div');
  bullet.className=`bullet${isMiss?' miss-bullet':''}`;
  bullet.style.left=`${startX}px`;
  bullet.style.top=`${startY}px`;
  bullet.style.width=`${Math.max(90,(hitX-startX)*.2)}px`;
  bullet.style.setProperty('--travel',`${hitX-startX}px`);
  bullet.style.setProperty('--rise',`${hitY-startY}px`);
  fxLayer.appendChild(bullet);

  await wait(110);
  if(!dead)setSprite(bombing,SPRITES.bombingIdle);
  bullet.remove();
  if(dead)return;

  if(isMiss){
    attackerStats[attacker].missCount++;
    showDamagePopup(attacker, 0, 'miss');

    const miss=document.createElement('div');
    miss.className='damage miss';
    miss.textContent='MISS';
    miss.style.left=`${gw*(.77+Math.random()*.08)}px`;
    miss.style.top=`${gh*(.36+Math.random()*.18)}px`;
    fxLayer.appendChild(miss);

    missSound();
    addDamageLog('miss', 0, attacker);
    lastAttack.textContent=`${attacker} · MISS`;
    setTimeout(()=>miss.remove(),1150);
    await wait(Math.max(80,config.shotInterval-150));
    return;
  }

  const defendedDamage=applyBossDefense(damage);
  const actual=Math.min(defendedDamage,currentHp);
  const isCritical=type==='critical';
  const isJackpot=type==='jackpot';
  const isWeak=type==='weak';
  const isKill=defendedDamage>=currentHp;

  attackerStats[attacker].totalDamage += actual;
  if(isCritical) attackerStats[attacker].critCount++;
  if(isJackpot) attackerStats[attacker].jackpotCount++;

  if(actual > attackerStats[attacker].maxHitDamage) {
    attackerStats[attacker].maxHitDamage = actual;
  }

  showDamagePopup(attacker, actual, type);

  const impact=document.createElement('div');
  impact.className=`impact${isJackpot?' jackpot-impact':''}${isWeak?' weak-impact':''}`;
  impact.style.left=`${hitX-18}px`;
  impact.style.top=`${hitY-18}px`;
  fxLayer.appendChild(impact);

  const num=document.createElement('div');
  num.className=`damage ${type}${isKill?' kill':''}`;
  num.textContent=`-${actual.toLocaleString()}`;
  num.style.left=`${hitX}px`;
  num.style.top=`${hitY}px`;
  fxLayer.appendChild(num);

  sparks(hitX,hitY,isJackpot?24:isCritical?15:isWeak?5:8);
  setSprite(boss,SPRITES.bossHit);
  restartAnimation(boss,'hit');
  setTimeout(()=>{if(!dead)setSprite(boss,SPRITES.bossIdle)},190);
  screenShake(isJackpot||isCritical);
  hitSound(isJackpot||isCritical);
  addCombo();

  updateHp(currentHp-actual);
  addDamageLog(type, actual, attacker);
  lastAttack.textContent=isJackpot
    ? `${attacker} · JACKPOT · ${actual.toLocaleString()} DAMAGE`
    : `${attacker} · ${actual.toLocaleString()} DAMAGE`;

  if(isJackpot){
    showJackpotNotice();
  }

  setTimeout(()=>impact.remove(),420);
  setTimeout(()=>num.remove(),1150);

  if(currentHp<=0){
    defeatBoss(attacker,actual);
    return;
  }

  await wait(Math.max(80,config.shotInterval-150));
}

function updateLeftoverDisplay() {
  const leftoverEl = $('#winnerLeftover');
  if (!leftoverEl) return;

  if (remainingQueue.length === 0) {
    leftoverEl.textContent = `✨ 깔끔하게 잔탄 없이 클리어!`;
    return;
  }

  let summary = {};
  remainingQueue.forEach(item => {
    summary[item.nickname] = (summary[item.nickname] || 0) + item.count;
  });

  let textArr = Object.entries(summary).map(([name, cnt]) => `${name} ${cnt}발`);
  leftoverEl.textContent = `🔥 초과 탄환 대기: ${textArr.join(', ')}`;
}

function queueAttack(attacker, count) {
  if (dead) {
    remainingQueue.push({ nickname: attacker, count: count });
    updateLeftoverDisplay();
    return;
  }
  
  attackBtn.disabled = true; 
  multiBtn.disabled = true;
  
  shotQueue = shotQueue.then(async () => {
    for (let i = 0; i < count; i++) {
      if (dead) {
        remainingQueue.push({ nickname: attacker, count: count - i });
        updateLeftoverDisplay();
        break; 
      }
      await animateShot(randomDamage(), attacker);
    }
  }).finally(() => {
    if (!dead) {
      attackBtn.disabled = false; 
      multiBtn.disabled = false;
    }
  });
}

function defeatBoss(attacker, damage) {
  if (dead) return; 
  dead = true; 
  attackBtn.disabled = true; 
  multiBtn.disabled = true; 
  dangerBanner.classList.remove('show');
  
  setSprite(boss, SPRITES.bossDead); 
  restartAnimation(game, 'heavy-shake'); 
  boss.classList.add('dying'); 
  hitSound(true); 
  $('#phaseFlash').classList.add('on');
  
  $('#winnerName').textContent = attacker;
  $('#winnerDamage').textContent = `막타 데미지 ${damage.toLocaleString()}`;
  $('#winnerHitCount').textContent = totalHitCount.toLocaleString();

  updateLeftoverDisplay();

  // 💡 동률(공동 1등 / 공동 MISS왕 등)을 모두 수집하기 위한 로직
  let topDamageUsers = [];
  let maxDamageVal = -1;

  let topMaxHitUsers = [];
  let maxHitVal = -1;

  let topMissUsers = [];
  let maxMissVal = -1;

  for (let [name, stat] of Object.entries(attackerStats)) {
    // 딜량 1등 체크
    if (stat.totalDamage > maxDamageVal) {
      maxDamageVal = stat.totalDamage;
      topDamageUsers = [{ name, val: stat.totalDamage }];
    } else if (stat.totalDamage === maxDamageVal && maxDamageVal > 0) {
      topDamageUsers.push({ name, val: stat.totalDamage });
    }

    // 1타 최대 데미지 체크
    if (stat.maxHitDamage > maxHitVal) {
      maxHitVal = stat.maxHitDamage;
      topMaxHitUsers = [{ name, val: stat.maxHitDamage }];
    } else if (stat.maxHitDamage === maxHitVal && maxHitVal > 0) {
      topMaxHitUsers.push({ name, val: stat.maxHitDamage });
    }

    // MISS 왕 체크 (0회 초과일 때만)
    if (stat.missCount > maxMissVal) {
      maxMissVal = stat.missCount;
      topMissUsers = [{ name, val: stat.missCount }];
    } else if (stat.missCount === maxMissVal && maxMissVal > 0) {
      topMissUsers.push({ name, val: stat.missCount });
    }
  }

  // 텍스트 포맷팅 도우미 (공동 1등들이면 "A, B (각각 OO)" 형태로 묶어주기)
  const formatTies = (users, unit) => {
    if (users.length === 0 || (unit === '회 헛발질 ㅋㅋㅋ' && maxMissVal <= 0)) return '없음 (0회)';
    return users.map(u => `${u.name} (${u.val.toLocaleString()}${unit})`).join(', ');
  };

  const damageText = topDamageUsers.length > 0 ? formatTies(topDamageUsers, ' 데미지') : '없음';
  const maxHitText = topMaxHitUsers.length > 0 ? formatTies(topMaxHitUsers, ' 데미지') : '없음';
  const missText = maxMissVal > 0 ? formatTies(topMissUsers, '회 헛발질 ㅋㅋㅋ') : '없음 (0회)';

  const funStatsEl = $('#funStatsContainer');
  if (funStatsEl) {
    funStatsEl.innerHTML = `
      <div style="margin-top: 8px; font-size: 14px; font-family: 'MaplestoryOTFBold', sans-serif; color: #ffea00; background: rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 6px; border: 1px dashed #777; line-height: 1.5;">
        👑 <b>딜량 1등(MVP):</b> ${damageText}<br>
        🔥 <b>1타 최대 데미지:</b> ${maxHitText}<br>
        🤡 <b>눈 감았어(MISS왕):</b> ${missText}
      </div>
    `;
  }
  
  setTimeout(() => {
    winnerScreen.classList.add('show'); 
    winnerScreen.setAttribute('aria-hidden', 'false');
  }, 1050);
}

function resetBoss() {
  dead = false; 
  totalHitCount = 0; 
  combo = 0; 
  currentPhase = 1;
  attackerStats = {}; 
  clearTimeout(phaseNoticeTimer); 
  clearTimeout(jackpotNoticeTimer);
  phaseNotice.classList.remove('show'); 
  phaseNotice.setAttribute('aria-hidden', 'true');
  jackpotNotice.classList.remove('show'); 
  jackpotNotice.setAttribute('aria-hidden', 'true');
  setSprite(bombing, SPRITES.bombingIdle); 
  setSprite(boss, SPRITES.bossIdle);
  boss.className = 'fighter boss'; 
  winnerScreen.classList.remove('show'); 
  winnerScreen.setAttribute('aria-hidden', 'true');
  attackBtn.disabled = false; 
  multiBtn.disabled = false;
  $('#combo').classList.remove('show'); 
  updateHp(config.maxHp); 
  clearDamageLog(); 
  lastAttack.textContent = '대기 중';
  
  const leftoverEl = $('#winnerLeftover');
  if (leftoverEl) leftoverEl.textContent = '';
  
  const funStatsEl = $('#funStatsContainer');
  if (funStatsEl) funStatsEl.innerHTML = '';

  if (remainingQueue.length > 0) {
    const queueToRestore = [...remainingQueue];
    remainingQueue = [];

    setTimeout(() => {
      queueToRestore.forEach(item => {
        queueAttack(item.nickname, item.count);
      });
    }, 1200);
  }
}

attackBtn.addEventListener('click', () => queueAttack('익명의 부밍이', 1));
multiBtn.addEventListener('click', () => queueAttack('익명의 부밍이', config.multiCount));
$('#restartBtn').addEventListener('click', resetBoss);
$('#healBtn').addEventListener('click', resetBoss);
$('#settingsToggle').addEventListener('click', () => $('#settingsBody').classList.toggle('open'));

$('#applySettingsBtn').addEventListener('click', () => {
  const next = {
    bossName: $('#bossNameInput').value.trim() || '피즐리베어',
    maxHp: Math.floor(Number($('#maxHpInput').value)),
    minDamage: Math.floor(Number($('#minDamageInput').value)),
    maxDamage: Math.floor(Number($('#maxDamageInput').value)),
    multiCount: Math.floor(Number($('#multiCountInput').value)),
    shotInterval: Math.floor(Number($('#shotIntervalInput').value)),
    apiEnabled: $('#apiEnabledInput') ? $('#apiEnabledInput').checked : true,
    guideEnabled: $('#guideToggleInput') ? $('#guideToggleInput').checked : true
  };
  if (!Number.isFinite(next.maxHp) || next.maxHp < 1) return alert('최대 체력은 1 이상이어야 합니다.');
  if (!Number.isFinite(next.minDamage) || next.minDamage < 0) return alert('최소 데미지는 0 이상이어야 합니다.');
  if (!Number.isFinite(next.maxDamage) || next.maxDamage < next.minDamage) return alert('최대 데미지는 최소 데미지 이상이어야 합니다.');
  if (!Number.isFinite(next.multiCount) || next.multiCount < 1 || next.multiCount > 100) return alert('연속 공격 횟수는 1~100입니다.');
  if (!Number.isFinite(next.shotInterval) || next.shotInterval < 50) return alert('연사 간격은 50ms 이상이어야 합니다.');
  
  config = next; 
  saveSettings(); 
  syncInputs(); 
  applyGuideVisibility();
  resetBoss(); 
  $('#settingsBody').classList.remove('open');
});

function applyGuideVisibility() {
  const guidePanel = $('#damageGuidePanel');
  const guideToggle = $('#guideToggleInput');
  const guideToggleText = $('#guideToggleText');
  
  const isEnabled = config.guideEnabled !== false;
  if (guideToggle) guideToggle.checked = isEnabled;
  if (guideToggleText) {
    guideToggleText.textContent = isEnabled ? 'ON' : 'OFF';
    guideToggleText.style.color = isEnabled ? '#ffea00' : '#888';
  }
  if (guidePanel) {
    guidePanel.style.display = isEnabled ? 'block' : 'none';
  }
}

const guideToggleInput = $('#guideToggleInput');
if (guideToggleInput) {
  guideToggleInput.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const guideToggleText = $('#guideToggleText');
    const guidePanel = $('#damageGuidePanel');
    if (guideToggleText) {
      guideToggleText.textContent = isChecked ? 'ON' : 'OFF';
      guideToggleText.style.color = isChecked ? '#ffea00' : '#888';
    }
    if (guidePanel) {
      guidePanel.style.display = isChecked ? 'block' : 'none';
    }
  });
}

const apiEnabledInput = $('#apiEnabledInput');
if (apiEnabledInput) {
  apiEnabledInput.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const apiStatusText = $('#apiStatusText');
    if (apiStatusText) {
      apiStatusText.textContent = isChecked ? 'ON (작동 중)' : 'OFF (차단됨)';
      apiStatusText.style.color = isChecked ? '#ffea00' : '#ff3333';
    }
  });
}

const test100Btn = $('#test100Btn');
const test1000Btn = $('#test1000Btn');

if (test100Btn) {
  test100Btn.addEventListener('click', () => {
    window.raidAttack({ nickname: '테스트시청자1', amount: 100 });
  });
}

if (test1000Btn) {
  test1000Btn.addEventListener('click', () => {
    window.raidAttack({ nickname: '테스트회장님', amount: 1000 });
  });
}

window.raidAttack = ({nickname = '익명의 시청자', amount = 100} = {}) => {
  if (config.apiEnabled === false) {
    return; 
  }

  const amt = Number(amount);
  const thousandCount = Math.floor(amt / 1000);
  const remainderCount = Math.floor((amt % 1000) / 100);
  const count = (thousandCount * config.multiCount) + remainderCount;

  if (count <= 0) return;
  queueAttack(nickname, count);
};

window.raidReset = resetBoss;

loadSettings();
applyGuideVisibility();
updateHp(config.maxHp);
clearDamageLog();

const bulkQueueInput = document.getElementById('bulkQueueInput');
const bulkApplyBtn = document.getElementById('bulkApplyBtn');
const bulkClearBtn = document.getElementById('bulkClearBtn');
const bulkStatusText = document.getElementById('bulkStatusText');

if (bulkApplyBtn) {
  bulkApplyBtn.addEventListener('click', async () => {
    const text = bulkQueueInput.value.trim();
    if (!text) {
      alert('공격할 후원 목록을 입력해주세요!');
      return;
    }

    const lines = text.split(/\r?\n/);
    let individualShots = [];
    let hasError = false; // 👈 형식 오류가 있는지 체크할 변수
    let errorLineMsg = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // 빈 줄은 무시

      const parts = line.split(/\s+/);
      if (parts.length < 2) {
        hasError = true;
        errorLineMsg = `"${line}" 형식 오류! (예: 닉네임 횟수 형태여야 합니다)`;
        break;
      }

      const nickname = parts[0];
      const amount = Number(parts[1]);

      if (isNaN(amount) || amount <= 0) {
        hasError = true;
        errorLineMsg = `"${line}" 횟수 오류! (숫자만 올 수 있습니다)`;
        break;
      }

      const thousandCount = Math.floor(amount / 1000);
      const remainderCount = Math.floor((amount % 1000) / 100);
      const count = (thousandCount * config.multiCount) + remainderCount;

      if (count <= 0) {
        hasError = true;
        errorLineMsg = `"${line}" 횟수가 너무 적습니다 (최소 100 이상)`;
        break;
      }

      for (let j = 0; j < count; j++) {
        individualShots.push({ nickname });
      }
    }

    // 💡 형식에 안 맞는 줄이 하나라도 있으면 즉시 경고창을 띄우고 중단! (누락 방지)
    if (hasError) {
      alert(`입력 형식 오류가 발생했습니다!\n\n[오류 내용] ${errorLineMsg}\n\n모든 줄이 [닉네임 횟수] 형식인지 확인해주세요.`);
      return;
    }

    if (individualShots.length === 0) {
      alert('올바른 형식의 데이터가 없습니다.');
      return;
    }

    // 셔플
    for (let i = individualShots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [individualShots[i], individualShots[j]] = [individualShots[j], individualShots[i]];
    }

    bulkApplyBtn.disabled = true;
    bulkQueueInput.disabled = true;
    bulkStatusText.textContent = `🔥 총 ${individualShots.length}발 난사 셔플 시작...`;

    for (let i = 0; i < individualShots.length; i++) {
      const shot = individualShots[i];
      bulkStatusText.textContent = `난사 중: [${shot.nickname}] (${i + 1}/${individualShots.length})`;
      
      await new Promise(resolve => {
        queueAttack(shot.nickname, 1);
        const estimatedTime = config.shotInterval + 100;
        setTimeout(resolve, estimatedTime);
      });
    }

    bulkStatusText.textContent = '✨ 모든 난사 공격 완료!';
    bulkApplyBtn.disabled = false;
    bulkQueueInput.disabled = false;
    bulkQueueInput.value = '';
  });
}

if (bulkClearBtn) {
  bulkClearBtn.addEventListener('click', () => {
    bulkQueueInput.value = '';
    bulkStatusText.textContent = '대기 중인 공격 없음';
  });
}

const toggleTextareaBtn = document.getElementById('toggleTextareaBtn');
const textareaContainer = document.getElementById('textareaContainer');

if (toggleTextareaBtn && textareaContainer) {
  let isTextareaOpen = true;
  toggleTextareaBtn.addEventListener('click', () => {
    isTextareaOpen = !isTextareaOpen;
    if (isTextareaOpen) {
      textareaContainer.style.display = 'block';
      toggleTextareaBtn.textContent = '메모장 숨기기';
    } else {
      textareaContainer.style.display = 'none';
      toggleTextareaBtn.textContent = '메모장 펼치기';
    }
  });
}