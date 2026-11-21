import crypto from 'node:crypto';
import {loadWhitelist} from '../config/whitelist.js';
const users=loadWhitelist(),tokens=new Map();
export const authService={
 authenticate(username){return users.find(u=>u.username===username)||null;},
 issueToken(user){const token=crypto.randomBytes(32).toString('hex');tokens.set(token,{username:user.username,role:user.role});return token;},
 getUser(token){return tokens.get(token)||null;},
 revoke(token){tokens.delete(token);}
};
export function requireAuth(req,res,next){
 const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const user=authService.getUser(token);
 if(!user)return res.status(401).json({error:'Authentication required'});
 req.user=user;req.authToken=token;next();
}
