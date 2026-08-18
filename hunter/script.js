'use strict';

const CONFIG_DEFAULT = { bossPreset:'pizzlybear', bossName:'피즐리베어', maxHp:33000, minDamage:1, maxDamage:1500, multiCount:11, shotInterval:240, apiEnabled:false, guideEnabled:true };
let config = {...CONFIG_DEFAULT};
let currentHp = config.maxHp;
let dead = false;
let combo = 0;
let comboTimer = null;
let currentPhase = 1;
let phaseNoticeTimer = null;
let totalHitCount = 0;
let attackerStats = {};
let raidPlan=[];
let raidRunning=false;
let raidPaused=false;
let raidCancelled=false;
let queueInputMode=localStorage.getItem('pizzlyRaidQueueMode')==='pinball'?'pinball':'balloon';

const $ = s => document.querySelector(s);
const game=$('#game'), hpFill=$('#hpFill'), hpLag=$('#hpLag'), currentHpEl=$('#currentHp'), maxHpEl=$('#maxHp'), hpPercent=$('#hpPercent');
const boss=$('#boss'), bombing=$('#bombing'), muzzle=$('#muzzle'), fxLayer=$('#fxLayer'), dangerBanner=$('#dangerBanner');
const raidStartBtn=$('#raidStartBtn'), pauseBtn=$('#pauseBtn'), lastAttack=$('#lastAttack'), winnerScreen=$('#winnerScreen');
const armorStatus=$('#armorStatus'), phaseNotice=$('#phaseNotice'), phaseNoticeIcon=$('#phaseNoticeIcon'), phaseNoticeTitle=$('#phaseNoticeTitle'), phaseNoticeBossText=$('#phaseNoticeBossText'), phaseNoticeDefenseText=$('#phaseNoticeDefenseText');
const damageLog=$('#damageLog'), jackpotNotice=$('#jackpotNotice');
const MAX_DAMAGE_LOGS=10;
let damageLogSequence=0;
let jackpotNoticeTimer=null;

const RAID_THEMES={
  pizzlybear:{
    bossName:'피즐리베어',attackType:'gun',icon:'🎯',
    bombingIdle:'assets/bombing_idle.png',bombingAttack:'assets/bombing_attack.png',bombingShoot:'assets/bombing_shoot.png',
    bossIdle:'assets/pizzlybear_idle.png',bossHit:'assets/pizzlybear_hit.png',bossDead:'assets/pizzlybear_die.png'
  },
  tyrannosaurus:{
    bossName:'티라노사우루스',attackType:'blade',icon:'⚔️',
    bombingIdle:'assets/dualblade_idle.png',bombingAttack:'assets/dualblade_ready.png',bombingShoot:'assets/dualblade_slash.png',
    bossIdle:'assets/trex_idle.png',bossHit:'assets/trex_hit.png',bossDead:'assets/trex_die.png'
  }
};
let SPRITES={...RAID_THEMES.pizzlybear};
function setSprite(el,src){ if(el.getAttribute('src')!==src) el.setAttribute('src',src); }
function getRaidTheme(preset=config.bossPreset){return RAID_THEMES[preset]||RAID_THEMES.pizzlybear}
function applyRaidTheme(preset=config.bossPreset){
  const key=RAID_THEMES[preset]?preset:'pizzlybear',theme=RAID_THEMES[key];config.bossPreset=key;SPRITES={...theme};game.dataset.attackType=theme.attackType;
  setSprite(bombing,theme.bombingIdle);setSprite(boss,theme.bossIdle);setSprite($('.player-card img'),theme.bombingIdle);setSprite($('.winner-bombing'),theme.bombingIdle);setSprite($('.winner-boss'),theme.bossDead);
  boss.alt=config.bossName;$('.winner-boss').alt=`쓰러진 ${config.bossName}`;$('#attackTypeIcon').textContent=theme.icon;$('#winnerBossResultText').textContent=`${config.bossName} 처치 성공`;game.setAttribute('aria-label',`${config.bossName} 보스 레이드`);document.title=`${config.bossName} : FINAL HIT`;
}
function loadSettings(){ try{ const saved=JSON.parse(localStorage.getItem('pizzlyRaidConfig')); if(saved) config={...config,...saved}; }catch{} applyRaidTheme(config.bossPreset);syncInputs(); }
function syncInputs(){
  $('#bossPresetInput').value=config.bossPreset;
  $('#bossNameInput').value=config.bossName;
  $('#minDamageInput').value=config.minDamage;
  $('#maxDamageInput').value=config.maxDamage;
  $('#shotIntervalInput').value=config.shotInterval;
  $('#bossName').textContent=config.bossName;
}
function saveSettings(){ localStorage.setItem('pizzlyRaidConfig',JSON.stringify(config)); }

function getPhaseByPercent(pct){if(pct<=0)return 0;if(pct<=30)return 3;if(pct<=50)return 2;return 1}
function getDefenseRateForRatio(ratio){if(ratio<=.30)return .15;if(ratio<=.50)return .10;return 0}
function getDefenseRate(){return getDefenseRateForRatio(currentHp/config.maxHp)}
function applyBossDefense(damage){return Math.max(1,Math.floor(damage*(1-getDefenseRate())))}

function phaseAlertSound(finalPhase=false){
  try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type=finalPhase?'sawtooth':'triangle';o.frequency.setValueAtTime(finalPhase?180:420,t);o.frequency.exponentialRampToValueAtTime(finalPhase?70:720,t+.28);g.gain.setValueAtTime(finalPhase?.15:.10,t);g.gain.exponentialRampToValueAtTime(.001,t+.42);o.connect(g).connect(c.destination);o.start(t);o.stop(t+.45)}catch{}
}
function showPhaseNotice(phase){
  clearTimeout(phaseNoticeTimer);const finalPhase=phase===3;phaseNoticeIcon.textContent=finalPhase?'☠':'⚠';phaseNoticeTitle.textContent=finalPhase?'FINAL PHASE':'PHASE 2';phaseNoticeBossText.textContent=finalPhase?`${config.bossName}가 광폭화했습니다.`:`${config.bossName}가 분노했습니다.`;phaseNoticeDefenseText.textContent=finalPhase?'방어력이 5% 더 증가합니다. (현재 총 +15%)':'방어력이 10% 증가합니다.';phaseNotice.classList.remove('show','phase2','final');phaseNotice.classList.add(finalPhase?'final':'phase2');phaseNotice.setAttribute('aria-hidden','false');void phaseNotice.offsetWidth;phaseNotice.classList.add('show');restartAnimation(game,'heavy-shake');restartAnimation($('#phaseFlash'),'on');phaseAlertSound(finalPhase);phaseNoticeTimer=setTimeout(()=>{phaseNotice.classList.remove('show');phaseNotice.setAttribute('aria-hidden','true')},2600)
}
function updateHp(next){
  currentHp=Math.max(0,Math.min(config.maxHp,Math.round(next)));const pct=currentHp/config.maxHp*100;const nextPhase=getPhaseByPercent(pct);hpFill.style.width=`${pct}%`;hpLag.style.width=`${pct}%`;currentHpEl.textContent=currentHp.toLocaleString();maxHpEl.textContent=config.maxHp.toLocaleString();hpPercent.textContent=`${pct.toFixed(pct<10?1:0)}%`;hpFill.classList.toggle('low',pct<=20&&pct>0);dangerBanner.classList.toggle('show',pct<=20&&pct>0);$('#phaseText').textContent=nextPhase===3?'FINAL PHASE':nextPhase===2?'PHASE 2':nextPhase===1?'PHASE 1':'DEFEATED';armorStatus.classList.remove('active','final');if(nextPhase===3){armorStatus.textContent='🛡 DEF +15%';armorStatus.classList.add('active','final')}else if(nextPhase===2){armorStatus.textContent='🛡 DEF +10%';armorStatus.classList.add('active')}else armorStatus.textContent='🛡 DEF +0%';boss.classList.toggle('phase2',nextPhase===2);boss.classList.toggle('final-phase',nextPhase===3);game.classList.toggle('phase2-active',nextPhase===2);game.classList.toggle('final-phase-active',nextPhase===3);if(nextPhase>currentPhase&&currentPhase>0)showPhaseNotice(nextPhase);currentPhase=nextPhase
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
function swordSound(){try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain(),n=c.createBufferSource(),b=c.createBuffer(1,c.sampleRate*.18,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);n.buffer=b;o.type='sawtooth';o.frequency.setValueAtTime(950,t);o.frequency.exponentialRampToValueAtTime(180,t+.16);g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.09,t+.018);g.gain.exponentialRampToValueAtTime(.001,t+.19);o.connect(g);n.connect(g);g.connect(c.destination);o.start(t);n.start(t);o.stop(t+.2)}catch{}}
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

async function animateShot(result,attacker,{finalShot=false}={}){
  let {damage,type}=result;if(dead)return;totalHitCount++;if(!attackerStats[attacker])attackerStats[attacker]={totalDamage:0,hitCount:0,missCount:0,critCount:0,jackpotCount:0,maxHitDamage:0};attackerStats[attacker].hitCount++;
  const isBlade=getRaidTheme().attackType==='blade';
  const isMiss=type==='miss',gw=game.clientWidth,gh=game.clientHeight,startX=gw*.275,startY=gh*(.515+Math.random()*.035),hitX=isMiss?gw*(.91+Math.random()*.07):gw*(.74+Math.random()*.09),hitY=isMiss?gh*(Math.random()<.5?.28+Math.random()*.10:.70+Math.random()*.09):gh*(.43+Math.random()*.22);
  setSprite(bombing,SPRITES.bombingAttack);await wait(isBlade?125:160);if(dead)return;setSprite(bombing,SPRITES.bombingShoot);screenShake(false);
  const projectile=document.createElement('div');
  if(isBlade){
    restartAnimation(bombing,'blade-fire');swordSound();projectile.className=`slash-wave${isMiss?' miss-slash':''}`;projectile.style.left=`${startX-70}px`;projectile.style.top=`${startY-75}px`;projectile.style.setProperty('--slash-travel',`${hitX-startX}px`);projectile.style.setProperty('--slash-rise',`${hitY-startY}px`);
  }else{
    restartAnimation(bombing,'fire');restartAnimation(muzzle,'on');gunSound();muzzleBurst(startX,startY);projectile.className=`bullet${isMiss?' miss-bullet':''}`;projectile.style.left=`${startX}px`;projectile.style.top=`${startY}px`;projectile.style.width=`${Math.max(90,(hitX-startX)*.2)}px`;projectile.style.setProperty('--travel',`${hitX-startX}px`);projectile.style.setProperty('--rise',`${hitY-startY}px`);
  }
  fxLayer.appendChild(projectile);await wait(isBlade?150:110);if(!dead)setSprite(bombing,SPRITES.bombingIdle);projectile.remove();if(dead)return;
  if(isMiss){attackerStats[attacker].missCount++;showDamagePopup(attacker,0,'miss');const miss=document.createElement('div');miss.className='damage miss';miss.textContent='MISS';miss.style.left=`${gw*(.77+Math.random()*.08)}px`;miss.style.top=`${gh*(.36+Math.random()*.18)}px`;fxLayer.appendChild(miss);missSound();addDamageLog('miss',0,attacker);lastAttack.textContent=`${attacker} · MISS`;setTimeout(()=>miss.remove(),1150);await wait(Math.max(80,config.shotInterval-150));return}
  const actual=Math.min(Number(result.plannedDamage||damage),currentHp);const isCritical=type==='critical',isJackpot=type==='jackpot',isWeak=type==='weak',isKill=finalShot;
  attackerStats[attacker].totalDamage+=actual;if(isCritical)attackerStats[attacker].critCount++;if(isJackpot)attackerStats[attacker].jackpotCount++;attackerStats[attacker].maxHitDamage=Math.max(attackerStats[attacker].maxHitDamage,actual);showDamagePopup(attacker,actual,type);
  const impact=document.createElement('div');impact.className=`impact${isBlade?' blade-impact':''}${isJackpot?' jackpot-impact':''}${isWeak?' weak-impact':''}`;impact.style.left=`${hitX-18}px`;impact.style.top=`${hitY-18}px`;fxLayer.appendChild(impact);const num=document.createElement('div');num.className=`damage ${type}${isKill?' kill':''}`;num.textContent=`-${actual.toLocaleString()}`;num.style.left=`${hitX}px`;num.style.top=`${hitY}px`;fxLayer.appendChild(num);sparks(hitX,hitY,finalShot?30:isJackpot?24:isCritical?15:isWeak?5:8);setSprite(boss,SPRITES.bossHit);restartAnimation(boss,'hit');setTimeout(()=>{if(!dead)setSprite(boss,SPRITES.bossIdle)},190);screenShake(finalShot||isJackpot||isCritical);hitSound(finalShot||isJackpot||isCritical);addCombo();updateHp(currentHp-actual);addDamageLog(type,actual,attacker);lastAttack.textContent=finalShot?`${attacker} · FINAL HIT · ${actual.toLocaleString()} DAMAGE`:isJackpot?`${attacker} · JACKPOT · ${actual.toLocaleString()} DAMAGE`:`${attacker} · ${actual.toLocaleString()} DAMAGE`;if(isJackpot)showJackpotNotice();setTimeout(()=>impact.remove(),420);setTimeout(()=>num.remove(),1150);if(finalShot){defeatBoss(attacker,actual);return}await wait(Math.max(80,config.shotInterval-150))
}

function shotsFromAmount(amount){const n=Math.floor(Number(amount));return Math.floor(n/1000)*11+Math.floor((n%1000)/100)}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}return arr}
function parseBalloonParticipants(text){
  const entries=[];for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line)continue;const match=line.match(/^(.+?)\s+([0-9,]+)$/);if(!match)throw new Error(`"${line}" 형식 오류 · 닉네임 별풍선개수로 입력해주세요.`);const nickname=match[1].trim(),amount=Number(match[2].replaceAll(',','')),count=shotsFromAmount(amount);if(!Number.isFinite(amount)||amount<100||count<1)throw new Error(`"${line}" · 최소 100개부터 참가할 수 있습니다.`);entries.push({nickname,amount,count})}if(!entries.length)throw new Error('참가 명단을 입력해주세요.');return entries
}
function parsePinballParticipants(text){
  const merged=new Map();
  const tokens=text.split(/[,，\r\n]+/).map(token=>token.trim()).filter(Boolean);
  if(!tokens.length)throw new Error('핀볼 명단을 입력해주세요.');
  for(const token of tokens){
    const match=token.match(/^(.+?)\s*\*\s*([0-9]+)$/);
    if(!match)throw new Error(`"${token}" 형식 오류 · 짱구*5,짱아*10 형식으로 입력해주세요.`);
    const nickname=match[1].trim();
    const count=Number(match[2]);
    if(!nickname||!Number.isSafeInteger(count)||count<1)throw new Error(`"${token}" · 공격 횟수는 1회 이상이어야 합니다.`);
    merged.set(nickname,(merged.get(nickname)||0)+count);
  }
  return [...merged].map(([nickname,count])=>({nickname,count,amount:null}));
}
function parseParticipants(text){return queueInputMode==='pinball'?parsePinballParticipants(text):parseBalloonParticipants(text)}
function buildRaid(entries){
  const bullets=[];for(const e of entries)for(let i=0;i<e.count;i++)bullets.push({nickname:e.nickname,result:randomDamage()});shuffle(bullets);
  let finalResult=randomDamage();while(finalResult.type==='miss')finalResult=randomDamage();bullets[bullets.length-1].result=finalResult;bullets[bullets.length-1].finalShot=true;
  bullets.forEach((bullet,index)=>{if(bullet.result.type==='miss'){bullet.result.plannedDamage=0;return}const progress=index/Math.max(1,bullets.length-1);const defense=progress>=.70?.15:progress>=.50?.10:0;bullet.result.plannedDamage=Math.max(1,Math.floor(bullet.result.damage*(1-defense)))});
  config.maxHp=Math.max(1,bullets.reduce((sum,bullet)=>sum+Number(bullet.result.plannedDamage||0),0));return bullets
}
function updateRaidButtons(){if(raidStartBtn)raidStartBtn.disabled=raidRunning||!raidPlan.length;if(pauseBtn){pauseBtn.disabled=!raidRunning;pauseBtn.querySelector('b').textContent=raidPaused?'계속하기':'일시정지';pauseBtn.querySelector('small').textContent=raidPaused?'RESUME':'PAUSE'}}
async function startRaid(){
  if(raidRunning||!raidPlan.length)return;resetBoss(false);raidRunning=true;raidPaused=false;raidCancelled=false;updateRaidButtons();bulkQueueInput.disabled=true;bulkApplyBtn.disabled=true;bulkClearBtn.disabled=true;setQueueModeControlsDisabled(true);const total=raidPlan.length;
  for(let i=0;i<raidPlan.length;i++){while(raidPaused&&!raidCancelled)await wait(100);if(raidCancelled||dead)break;const shot=raidPlan[i];bulkStatusText.textContent=`공격 중 · ${i+1}/${total}회 · ${shot.nickname}${shot.finalShot?' · FINAL HIT':''}`;await animateShot(shot.result,shot.nickname,{finalShot:shot.finalShot})}
  raidRunning=false;updateRaidButtons();bulkQueueInput.disabled=false;bulkApplyBtn.disabled=false;bulkClearBtn.disabled=false;setQueueModeControlsDisabled(false);if(!dead&&!raidCancelled)bulkStatusText.textContent='레이드 종료';
}
function defeatBoss(attacker,damage){
  if(dead)return;dead=true;raidRunning=false;raidPlan=[];dangerBanner.classList.remove('show');setSprite(boss,SPRITES.bossDead);restartAnimation(game,'heavy-shake');boss.classList.add('dying');hitSound(true);$('#phaseFlash').classList.add('on');$('#winnerName').textContent=attacker;$('#winnerDamage').textContent=`막타 데미지 ${damage.toLocaleString()}`;$('#winnerHitCount').textContent=totalHitCount.toLocaleString();$('#winnerLeftover').textContent='✨ 모든 참가 공격 사용 완료 · 이월 없음';
  let topDamageUsers=[],maxDamageVal=-1,topMaxHitUsers=[],maxHitVal=-1,topMissUsers=[],maxMissVal=-1;for(const [name,stat] of Object.entries(attackerStats)){if(stat.totalDamage>maxDamageVal){maxDamageVal=stat.totalDamage;topDamageUsers=[{name,val:stat.totalDamage}]}else if(stat.totalDamage===maxDamageVal&&maxDamageVal>0)topDamageUsers.push({name,val:stat.totalDamage});if(stat.maxHitDamage>maxHitVal){maxHitVal=stat.maxHitDamage;topMaxHitUsers=[{name,val:stat.maxHitDamage}]}else if(stat.maxHitDamage===maxHitVal&&maxHitVal>0)topMaxHitUsers.push({name,val:stat.maxHitDamage});if(stat.missCount>maxMissVal){maxMissVal=stat.missCount;topMissUsers=[{name,val:stat.missCount}]}else if(stat.missCount===maxMissVal&&maxMissVal>0)topMissUsers.push({name,val:stat.missCount})}
  const fmt=(users,unit)=>users.map(u=>`${u.name} (${u.val.toLocaleString()}${unit})`).join(', ');const funStatsEl=$('#funStatsContainer');if(funStatsEl)funStatsEl.innerHTML=`<div style="margin-top:8px;font-size:14px;color:#ffea00;background:rgba(0,0,0,.5);padding:8px 12px;border-radius:6px;border:1px dashed #777;line-height:1.5">👑 <b>딜량 1등(MVP):</b> ${topDamageUsers.length?fmt(topDamageUsers,' 데미지'):'없음'}<br>🔥 <b>1타 최대 데미지:</b> ${topMaxHitUsers.length?fmt(topMaxHitUsers,' 데미지'):'없음'}<br>🤡 <b>MISS왕:</b> ${maxMissVal>0?fmt(topMissUsers,'회'):'없음 (0회)'}</div>`;bulkStatusText.textContent=`🏆 FINAL HIT · ${attacker}`;updateRaidButtons();setTimeout(()=>{winnerScreen.classList.add('show');winnerScreen.setAttribute('aria-hidden','false')},1050)
}
function resetBoss(clearPlan=true){
  raidCancelled=true;raidRunning=false;raidPaused=false;if(clearPlan)raidPlan=[];dead=false;totalHitCount=0;combo=0;currentPhase=1;attackerStats={};clearTimeout(phaseNoticeTimer);clearTimeout(jackpotNoticeTimer);phaseNotice.classList.remove('show');phaseNotice.setAttribute('aria-hidden','true');jackpotNotice.classList.remove('show');jackpotNotice.setAttribute('aria-hidden','true');setSprite(bombing,SPRITES.bombingIdle);setSprite(boss,SPRITES.bossIdle);boss.className='fighter boss';winnerScreen.classList.remove('show');winnerScreen.setAttribute('aria-hidden','true');$('#combo').classList.remove('show');updateHp(config.maxHp);clearDamageLog();lastAttack.textContent='대기 중';$('#winnerLeftover').textContent='';const funStatsEl=$('#funStatsContainer');if(funStatsEl)funStatsEl.innerHTML='';if(clearPlan)bulkStatusText.textContent='참가 명단을 입력해주세요';updateRaidButtons()
}

$('#restartBtn').addEventListener('click',()=>{bulkQueueInput.value='';resetBoss(true)});$('#healBtn').addEventListener('click',()=>resetBoss(true));$('#settingsToggle').addEventListener('click',()=>$('#settingsBody').classList.toggle('open'));
$('#bossPresetInput').addEventListener('change',e=>{$('#bossNameInput').value=getRaidTheme(e.target.value).bossName});
$('#applySettingsBtn').addEventListener('click',()=>{const bossPreset=$('#bossPresetInput').value;const next={...config,bossPreset,bossName:$('#bossNameInput').value.trim()||getRaidTheme(bossPreset).bossName,minDamage:Math.floor(Number($('#minDamageInput').value)),maxDamage:Math.floor(Number($('#maxDamageInput').value)),shotInterval:Math.floor(Number($('#shotIntervalInput').value)),guideEnabled:$('#guideToggleInput')?$('#guideToggleInput').checked:true};if(!Number.isFinite(next.minDamage)||next.minDamage<0)return alert('최소 데미지는 0 이상이어야 합니다.');if(!Number.isFinite(next.maxDamage)||next.maxDamage<next.minDamage)return alert('최대 데미지는 최소 데미지 이상이어야 합니다.');if(!Number.isFinite(next.shotInterval)||next.shotInterval<50)return alert('연사 간격은 50ms 이상이어야 합니다.');config=next;applyRaidTheme(config.bossPreset);saveSettings();syncInputs();applyGuideVisibility();resetBoss(true);$('#settingsBody').classList.remove('open')});
function applyGuideVisibility(){const panel=$('#damageGuidePanel'),toggle=$('#guideToggleInput'),text=$('#guideToggleText'),enabled=config.guideEnabled!==false;if(toggle)toggle.checked=enabled;if(text){text.textContent=enabled?'ON':'OFF';text.style.color=enabled?'#ffea00':'#888'}if(panel)panel.style.display=enabled?'block':'none'}
$('#guideToggleInput')?.addEventListener('change',e=>{config.guideEnabled=e.target.checked;applyGuideVisibility()});
window.raidAttack=({nickname='익명의 시청자',amount=100}={})=>{if(raidRunning)return;setQueueInputMode('balloon');const old=bulkQueueInput.value.trim();bulkQueueInput.value=(old?old+'\n':'')+`${nickname} ${amount}`;bulkStatusText.textContent='후원 내역 추가됨 · 명단 확인·장전을 눌러주세요'};window.raidReset=()=>resetBoss(true);

const bulkQueueInput=document.getElementById('bulkQueueInput'),bulkApplyBtn=document.getElementById('bulkApplyBtn'),bulkClearBtn=document.getElementById('bulkClearBtn'),bulkStatusText=document.getElementById('bulkStatusText');
const balloonModeBtn=document.getElementById('balloonModeBtn'),pinballModeBtn=document.getElementById('pinballModeBtn'),queueFormatHelp=document.getElementById('queueFormatHelp'),raidAmountRule=document.getElementById('raidAmountRule');
function setQueueModeControlsDisabled(disabled){if(balloonModeBtn)balloonModeBtn.disabled=disabled;if(pinballModeBtn)pinballModeBtn.disabled=disabled}
function setQueueInputMode(mode,{resetPlan=true}={}){
  if(raidRunning)return;
  queueInputMode=mode==='pinball'?'pinball':'balloon';
  localStorage.setItem('pizzlyRaidQueueMode',queueInputMode);
  const isPinball=queueInputMode==='pinball';
  balloonModeBtn?.classList.toggle('active',!isPinball);pinballModeBtn?.classList.toggle('active',isPinball);
  balloonModeBtn?.setAttribute('aria-pressed',String(!isPinball));pinballModeBtn?.setAttribute('aria-pressed',String(isPinball));
  if(queueFormatHelp)queueFormatHelp.textContent=isPinball?'형식: 짱구*5,짱아*10,봉미선*3 (쉼표 구분)':'형식: 닉네임 별풍선개수 (한 줄에 한 명)';
  if(raidAmountRule)raidAmountRule.textContent=isPinball?'* 뒤 수량만큼 공격 횟수로 적용됩니다.':'100개당 1회 · 1,000개당 11회';
  bulkQueueInput.placeholder=isPinball?'예시)\n짱구*5,짱아*10,봉미선*3':'예시)\n부밍이 500\n밍밍이 1000';
  if(resetPlan){raidPlan=[];bulkStatusText.textContent=isPinball?'핀볼 복붙 모드 · 명단을 입력해주세요':'별풍선 명단 모드 · 명단을 입력해주세요';updateRaidButtons()}
}
balloonModeBtn?.addEventListener('click',()=>setQueueInputMode('balloon'));
pinballModeBtn?.addEventListener('click',()=>setQueueInputMode('pinball'));
bulkApplyBtn.addEventListener('click',()=>{if(raidRunning)return;try{const entries=parseParticipants(bulkQueueInput.value);raidPlan=buildRaid(entries);raidCancelled=false;currentPhase=1;dead=false;updateHp(config.maxHp);if(queueInputMode==='pinball'){bulkStatusText.textContent=`장전 완료 · ${entries.length}명 · ${raidPlan.length}회`}else{const stars=entries.reduce((s,e)=>s+e.amount,0);bulkStatusText.textContent=`장전 완료 · ${entries.length}명 · ${stars.toLocaleString()}개 · ${raidPlan.length}회`}updateRaidButtons()}catch(e){alert(e.message)}});
bulkClearBtn.addEventListener('click',()=>{if(raidRunning)return;bulkQueueInput.value='';raidPlan=[];bulkStatusText.textContent='참가 명단을 입력해주세요';updateRaidButtons()});
raidStartBtn.addEventListener('click',startRaid);pauseBtn.addEventListener('click',()=>{if(!raidRunning)return;raidPaused=!raidPaused;bulkStatusText.textContent=raidPaused?'⏸ 레이드 일시정지':bulkStatusText.textContent;updateRaidButtons()});
const toggleTextareaBtn=document.getElementById('toggleTextareaBtn'),textareaContainer=document.getElementById('textareaContainer');toggleTextareaBtn?.addEventListener('click',()=>{const open=textareaContainer.style.display==='none';textareaContainer.style.display=open?'block':'none';toggleTextareaBtn.textContent=open?'메모장 숨기기':'메모장 펼치기'});
loadSettings();applyGuideVisibility();updateHp(config.maxHp);clearDamageLog();setQueueInputMode(queueInputMode,{resetPlan:false});updateRaidButtons();
