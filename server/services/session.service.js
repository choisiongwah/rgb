import {randomBytes} from 'node:crypto';
const COLORS=['RED','GREEN','BLUE'];
export class SessionService{
 constructor(){this.sessions=new Map();}
 create({host}){
  const id=randomBytes(4).toString('hex').toUpperCase();
  const s={id,host,status:'waiting',createdAt:Date.now(),players:COLORS.map(color=>({color,token:randomBytes(24).toString('hex'),player:null,connected:false})),game:{key:'rgb-reaction',stage:1,paused:false}};
  this.sessions.set(id,s);return s;
 }
 get(id){return this.sessions.get(id);}
 toHostView(s){return {id:s.id,status:s.status,game:s.game,players:s.players.map(p=>({color:p.color,joinToken:p.token,player:p.player,connected:p.connected}))};}
 join(id,token,profile){
  const s=this.get(id);if(!s)throw Error('SESSION_NOT_FOUND');
  const slot=s.players.find(p=>p.token===token);if(!slot)throw Error('INVALID_JOIN_TOKEN');
  if(slot.connected)throw Error('SLOT_OCCUPIED');
  slot.player=profile;slot.connected=true;return {session:s,slot};
 }
}
