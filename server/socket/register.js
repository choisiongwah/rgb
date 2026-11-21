import {z} from 'zod';
import {authService} from '../middleware/auth.js';
const inputSchema=z.object({action:z.enum(['R','G','B']),sequence:z.number().int().nonnegative().optional()});
export function registerSocketHandlers(io,{sessions}){
 io.use((socket,next)=>{socket.data.user=authService.getUser(socket.handshake.auth?.token);socket.data.sessionId=socket.handshake.auth?.sessionId;socket.data.joinToken=socket.handshake.auth?.joinToken;next();});
 io.on('connection',socket=>{
  if(socket.data.user){
   socket.on('host:subscribe',({sessionId},ack=()=>{})=>{
    const s=sessions.get(sessionId);if(!s||s.host.username!==socket.data.user.username)return ack({ok:false,error:'SESSION_NOT_FOUND'});
    socket.join('session:'+sessionId);ack({ok:true,session:sessions.toHostView(s)});
   });return;
  }
  socket.on('player:join',(profile,ack=()=>{})=>{
   try{const {session,slot}=sessions.join(socket.data.sessionId,socket.data.joinToken,{name:String(profile.name||'').slice(0,20)});
    socket.join('session:'+session.id);io.to('session:'+session.id).emit('player:joined',{color:slot.color,player:slot.player});ack({ok:true,color:slot.color});
   }catch(e){ack({ok:false,error:e.message});}
  });
  socket.on('player:input',(payload,ack=()=>{})=>{
   const parsed=inputSchema.safeParse(payload);if(!parsed.success)return ack({ok:false,error:'INVALID_INPUT'});
   const s=sessions.get(socket.data.sessionId),slot=s?.players.find(p=>p.token===socket.data.joinToken&&p.connected);
   if(!slot)return ack({ok:false,error:'PLAYER_NOT_JOINED'});
   io.to('session:'+s.id).emit('game:input',{player:slot.color,action:parsed.data.action,sequence:parsed.data.sequence,receivedAt:Date.now()});ack({ok:true});
  });
 });
}
