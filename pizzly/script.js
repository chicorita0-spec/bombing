'use strict';

const CONFIG_DEFAULT = { bossName:'피즐리베어', maxHp:30000, minDamage:1, maxDamage:2000, multiCount:11, shotInterval:240 };
let config = {...CONFIG_DEFAULT};
let currentHp = config.maxHp;
let dead = false;
let shotQueue = Promise.resolve();
let combo = 0;
let comboTimer = null;
let currentPhase = 1;
let phaseNoticeTimer = null;

const $ = s => document.querySelector(s);
const game=$('#game'), hpFill=$('#hpFill'), hpLag=$('#hpLag'), currentHpEl=$('#currentHp'), maxHpEl=$('#maxHp'), hpPercent=$('#hpPercent');
const boss=$('#boss'), bombing=$('#bombing'), muzzle=$('#muzzle'), fxLayer=$('#fxLayer'), dangerBanner=$('#dangerBanner');
const attackBtn=$('#attackBtn'), multiBtn=$('#multiBtn'), lastAttack=$('#lastAttack'), winnerScreen=$('#winnerScreen');
const armorStatus=$('#armorStatus'), phaseNotice=$('#phaseNotice'), phaseNoticeIcon=$('#phaseNoticeIcon'), phaseNoticeTitle=$('#phaseNoticeTitle'), phaseNoticeBossText=$('#phaseNoticeBossText'), phaseNoticeDefenseText=$('#phaseNoticeDefenseText');

const SPRITES={ bombingIdle:'assets/bombing_idle.png', bombingAttack:'assets/bombing_attack.png', bombingShoot:'assets/bombing_shoot.png', bossIdle:'assets/pizzlybear_idle.png', bossHit:'assets/pizzlybear_hit.png', bossDead:'assets/pizzlybear_die.png' };
function setSprite(el,src){ if(el.getAttribute('src')!==src) el.setAttribute('src',src); }

function loadSettings(){ try{ const saved=JSON.parse(localStorage.getItem('pizzlyRaidConfig')); if(saved) config={...config,...saved}; }catch{} syncInputs(); }
function syncInputs(){ $('#bossNameInput').value=config.bossName; $('#maxHpInput').value=config.maxHp; $('#minDamageInput').value=config.minDamage; $('#maxDamageInput').value=config.maxDamage; $('#multiCountInput').value=config.multiCount; $('#shotIntervalInput').value=config.shotInterval; $('#bossName').textContent=config.bossName; }
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

// 데미지 등급:
// 5% 꽝      : 최소 데미지 ~ 최대 데미지의 10% (검은색)
// 5% 초대박  : 최대 데미지 초과 ~ 최대 데미지의 4배 (빨간색)
// 90% 일반   : 최대 데미지의 10% 초과 ~ 최대 데미지
// 일반 중 최대 데미지의 85% 이상은 기존 주황색 크리티컬
function randomDamage(){
  const min=config.minDamage;
  const max=config.maxDamage;
  const roll=Math.random();

  const lowUpper=Math.max(min,Math.floor(max*0.10));

  if(roll<0.05){
    return {
      damage:randomInt(min,lowUpper),
      type:'miss'
    };
  }

  if(roll<0.10){
    return {
      damage:randomInt(max+1,max*4),
      type:'jackpot'
    };
  }

  const normalMin=Math.min(max,lowUpper+1);
  const damage=randomInt(normalMin,max);

  return {
    damage,
    type:damage>=max*0.85?'critical':'normal'
  };
}
function nickname(){ return $('#nicknameInput').value.trim() || '익명의 시청자'; }

let audioCtx=null;
function audio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function gunSound(){ try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain(),n=c.createBufferSource(),b=c.createBuffer(1,c.sampleRate*.08,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);n.buffer=b;o.type='square';o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(55,t+.08);g.gain.setValueAtTime(.12,t);g.gain.exponentialRampToValueAtTime(.001,t+.1);o.connect(g);n.connect(g);g.connect(c.destination);o.start(t);n.start(t);o.stop(t+.1)}catch{}}
function hitSound(big=false){try{const c=audio(),t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type='sawtooth';o.frequency.setValueAtTime(big?90:160,t);o.frequency.exponentialRampToValueAtTime(38,t+.15);g.gain.setValueAtTime(big?.18:.08,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);o.connect(g).connect(c.destination);o.start();o.stop(t+.2)}catch{}}

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

async function animateShot(result, attacker){
  const {damage,type}=result;
  if(dead)return;
  const gw=game.clientWidth,gh=game.clientHeight;
  const startX=gw*.275,startY=gh*(.515+Math.random()*.035),hitX=gw*(.74+Math.random()*.09),hitY=gh*(.43+Math.random()*.22);
  setSprite(bombing,SPRITES.bombingAttack);
  await wait(160);
  if(dead)return;
  setSprite(bombing,SPRITES.bombingShoot);
  restartAnimation(bombing,'fire');restartAnimation(muzzle,'on');gunSound();muzzleBurst(startX,startY);screenShake(false);
  const bullet=document.createElement('div');bullet.className='bullet';bullet.style.left=`${startX}px`;bullet.style.top=`${startY}px`;bullet.style.width=`${Math.max(90,(hitX-startX)*.2)}px`;bullet.style.setProperty('--travel',`${hitX-startX}px`);fxLayer.appendChild(bullet);
  await wait(110);
  if(!dead)setSprite(bombing,SPRITES.bombingIdle);
  bullet.remove(); if(dead)return;
  const defendedDamage=applyBossDefense(damage);
  const actual=Math.min(defendedDamage,currentHp);
  const isCritical=type==='critical';
  const isJackpot=type==='jackpot';
  const isMiss=type==='miss';
  const isBig=isCritical||isJackpot;
  const isKill=defendedDamage>=currentHp;

  const impact=document.createElement('div');
  impact.className=`impact${isJackpot?' jackpot-impact':''}${isMiss?' miss-impact':''}`;
  impact.style.left=`${hitX-18}px`;
  impact.style.top=`${hitY-18}px`;
  fxLayer.appendChild(impact);

  const num=document.createElement('div');
  num.className=`damage ${type}${isKill?' kill':''}`;
  num.textContent=`-${actual.toLocaleString()}`;
  num.style.left=`${hitX}px`;
  num.style.top=`${hitY}px`;
  fxLayer.appendChild(num);

  sparks(hitX,hitY,isJackpot?24:isCritical?15:isMiss?4:8);
  setSprite(boss,SPRITES.bossHit);
  restartAnimation(boss,'hit');
  setTimeout(()=>{if(!dead)setSprite(boss,SPRITES.bossIdle)},190);
  screenShake(isJackpot||isCritical);
  hitSound(isJackpot||isCritical);
  addCombo();
  updateHp(currentHp-actual);lastAttack.textContent=`${attacker} · ${actual.toLocaleString()} DAMAGE`;
  setTimeout(()=>impact.remove(),420);setTimeout(()=>num.remove(),1150);
  if(currentHp<=0){defeatBoss(attacker,actual);return;}
  await wait(Math.max(80,config.shotInterval-150));
}

function queueAttack(attacker,count){
  if(dead)return; attackBtn.disabled=true;multiBtn.disabled=true;
  shotQueue=shotQueue.then(async()=>{for(let i=0;i<count;i++){if(dead)break;await animateShot(randomDamage(),attacker)}}).finally(()=>{if(!dead){attackBtn.disabled=false;multiBtn.disabled=false}});
}

function defeatBoss(attacker,damage){
  if(dead)return; dead=true; attackBtn.disabled=true;multiBtn.disabled=true;dangerBanner.classList.remove('show');
  setSprite(boss,SPRITES.bossDead);restartAnimation(game,'heavy-shake');boss.classList.add('dying');hitSound(true);$('#phaseFlash').classList.add('on');
  $('#winnerName').textContent=attacker;$('#winnerDamage').textContent=`막타 데미지 ${damage.toLocaleString()}`;
  setTimeout(()=>{winnerScreen.classList.add('show');winnerScreen.setAttribute('aria-hidden','false')},1050);
}
function resetBoss(){dead=false;combo=0;currentPhase=1;clearTimeout(phaseNoticeTimer);phaseNotice.classList.remove('show');phaseNotice.setAttribute('aria-hidden','true');setSprite(bombing,SPRITES.bombingIdle);setSprite(boss,SPRITES.bossIdle);boss.className='fighter boss';winnerScreen.classList.remove('show');winnerScreen.setAttribute('aria-hidden','true');attackBtn.disabled=false;multiBtn.disabled=false;$('#combo').classList.remove('show');updateHp(config.maxHp);lastAttack.textContent='대기 중';}

attackBtn.addEventListener('click',()=>queueAttack(nickname(),1));
multiBtn.addEventListener('click',()=>queueAttack(nickname(),config.multiCount));
$('#restartBtn').addEventListener('click',resetBoss);$('#healBtn').addEventListener('click',resetBoss);
$('#settingsToggle').addEventListener('click',()=>$('#settingsBody').classList.toggle('open'));
$('#applySettingsBtn').addEventListener('click',()=>{
  const next={bossName:$('#bossNameInput').value.trim()||'피즐리베어',maxHp:Math.floor(Number($('#maxHpInput').value)),minDamage:Math.floor(Number($('#minDamageInput').value)),maxDamage:Math.floor(Number($('#maxDamageInput').value)),multiCount:Math.floor(Number($('#multiCountInput').value)),shotInterval:Math.floor(Number($('#shotIntervalInput').value))};
  if(!Number.isFinite(next.maxHp)||next.maxHp<1)return alert('최대 체력은 1 이상이어야 합니다.');
  if(!Number.isFinite(next.minDamage)||next.minDamage<0)return alert('최소 데미지는 0 이상이어야 합니다.');
  if(!Number.isFinite(next.maxDamage)||next.maxDamage<next.minDamage)return alert('최대 데미지는 최소 데미지 이상이어야 합니다.');
  if(!Number.isFinite(next.multiCount)||next.multiCount<1||next.multiCount>100)return alert('연속 공격 횟수는 1~100입니다.');
  if(!Number.isFinite(next.shotInterval)||next.shotInterval<50)return alert('연사 간격은 50ms 이상이어야 합니다.');
  config=next;saveSettings();syncInputs();resetBoss();$('#settingsBody').classList.remove('open');
});

// 방송 후원 API/브릿지가 붙으면 이 함수만 호출하면 됩니다.
// 예: window.raidAttack({ nickname: '홍길동', amount: 1000 })
window.raidAttack=({nickname='익명의 시청자',amount=100}={})=>{
  const count=Number(amount)>=1000?config.multiCount:Math.max(1,Math.floor(Number(amount)/100));
  $('#nicknameInput').value=nickname;queueAttack(nickname,count);
};
window.raidReset=resetBoss;

loadSettings();updateHp(config.maxHp);
