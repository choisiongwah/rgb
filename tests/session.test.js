import {describe,expect,it} from 'vitest';
import {SessionService} from '../server/services/session.service.js';
describe('SessionService',()=>it('creates three distinct player slots and tokens',()=>{
 const service=new SessionService(),s=service.create({host:{username:'admin',role:'admin'}});
 expect(s.players).toHaveLength(3);
 expect(new Set(s.players.map(p=>p.color)).size).toBe(3);
 expect(new Set(s.players.map(p=>p.token)).size).toBe(3);
}));
