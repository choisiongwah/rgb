import {io} from 'socket.io-client';
import './player.css';
const root=document.querySelector('#app'),params=new URLSearchParams(location.search),sessionId=params.get('sessionId'),joinToken=params.get('joinToken');
if(!sessionId||!joinToken)root.textContent='Invalid player link';
else{
 root.innerHTML='<h1>Join RGB</h1><form id="join"><input name="name" maxlength="20" placeholder="Your name" required><button>Join game</button></form><p id="status"></p>';
 root.querySelector('#join').addEventListener('submit',e=>{
  e.preventDefault();const name=new FormData(e.currentTarget).get('name').trim();if(!name)return;const socket=io({auth:{sessionId,joinToken}});
  socket.on('connect',()=>socket.emit('player:join',{name},ack=>{
   if(!ack.ok){root.querySelector('#status').textContent=ack.error;return;}
   root.innerHTML='<header><h1>'+escapeHtml(name)+'</h1><span id="state">Connected · '+ack.color+'</span></header><div class="pad"><button data-a="R" class="red">R</button><button data-a="G" class="green">G</button><button data-a="B" class="blue">B</button></div>';
   root.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',()=>socket.emit('player:input',{action:b.dataset.a},result=>{if(!result.ok)document.querySelector('#state').textContent='Disconnected';})));
  }));
  socket.on('disconnect',()=>{const el=document.querySelector('#state');if(el)el.textContent='Reconnecting…';});
 });
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
