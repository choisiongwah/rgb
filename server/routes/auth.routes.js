import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {authService} from '../middleware/auth.js';
const router=Router(),scrypt=promisify(scryptCb);
router.post('/login',rateLimit({windowMs:900000,limit:10}),async(req,res)=>{
 const username=String(req.body?.username||'').trim(),password=String(req.body?.password||'');
 const user=authService.authenticate(username);
 if(!user||user.passwordHash?.algorithm!=='scrypt')return res.status(401).json({error:'Invalid username or password'});
 const expected=Buffer.from(user.passwordHash.hash,'base64');
 const actual=await scrypt(password,Buffer.from(user.passwordHash.salt,'base64'),expected.length);
 if(!timingSafeEqual(expected,actual))return res.status(401).json({error:'Invalid username or password'});
 const token=authService.issueToken(user);res.json({token,user:{username:user.username,role:user.role}});
});
router.get('/me',(req,res)=>{
 const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const user=authService.getUser(token);if(!user)return res.status(401).json({error:'Authentication required'});
 res.json({user});
});
router.post('/logout',(req,res)=>{
 const token=(req.get('authorization')||'').replace(/^Bearer\s+/i,'');authService.revoke(token);res.status(204).end();
});
export {router as authRouter};
