import QRCode from 'qrcode';
import Phaser from 'phaser';
import {io} from 'socket.io-client';
import './host.css';
const $=s=>document.querySelector(s);let token=sessionStorage.getItem('rgb-token'),socket;
function show(user){$('#login').hidden=true;$('#dashboard').hidden=false;$('#welcome').textContent='Signed in as '+user.username+' ('+user.role+')';}
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);
 const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})});
 const d=await r.json();if(!r.ok){$('#error').textContent=d.error;return;}token=d.token;sessionStorage.setItem('rgb-token',token);show(d.user);
});
$('#logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});sessionStorage.removeItem('rgb-token');location.reload();});
$('#create').addEventListener('click',async()=>{
 const r=await fetch('/api/sessions',{method:'POST',headers:{Authorization:'Bearer '+token}}),s=await r.json();if(!r.ok){$('#error').textContent=s.error;return;}
 $('#session-id').textContent='Session '+s.id;$('#slots').innerHTML='';
 for(const p of s.players){const card=document.createElement('article');card.className='slot '+p.color.toLowerCase();const h=document.createElement('h3');h.textContent=p.color;const img=document.createElement('img');img.alt='Join '+p.color;img.src=await QRCode.toDataURL(location.origin+'/player/?sessionId='+s.id+'&joinToken='+p.joinToken);const status=document.createElement('p');status.textContent='Waiting for player';card.append(h,img,status);$('#slots').append(card);}
 socket=io({auth:{token}});socket.emit('host:subscribe',{sessionId:s.id},ack=>{if(!ack.ok)console.error(ack.error);});
 socket.on('game:input',input=>window.dispatchEvent(new CustomEvent('rgb:input',{detail:input})));
 new Phaser.Game({type:Phaser.AUTO,parent:'game-root',width:960,height:360,backgroundColor:'#111827',scene:{create(){
  this.add.text(480,70,'RGB REACTION',{fontSize:'40px',color:'#fff'}).setOrigin(.5);
  const label=this.add.text(480,200,'Waiting for player input',{fontSize:'32px',color:'#cbd5e1'}).setOrigin(.5);
  window.addEventListener('rgb:input',e=>{const c={R:'#ef4444',G:'#22c55e',B:'#3b82f6'};label.setText(e.detail.player+' pressed '+e.detail.action).setColor(c[e.detail.action]);});
 }}});
});
if(token)fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token}}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>show(d.user)).catch(()=>{sessionStorage.removeItem('rgb-token');token=null;});
