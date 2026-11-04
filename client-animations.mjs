import {installRunwayAdmin} from './runway-admin.mjs';
import {fileURLToPath} from 'node:url';
export function installClientAnimations({app,pool,requireAuth,commerce,resourceProtection,storage,decodeImage,fetchImpl}){
 const enabled=(req,res,next)=>commerce.applies(req.user)&&commerce.animationEnabled?next():res.status(503).json({ok:false,error:'Les animations ne sont pas encore activées pour ce compte.'});
 const access=(req,res,next)=>requireAuth(req,res,()=>enabled(req,res,next));
 const media=(req,res,next)=>resourceProtection.media({method:'POST',path:'/api/animations/media',user:req.user,setTimeout:req.setTimeout?.bind(req),destroy:req.destroy?.bind(req)},res,next);
 app.get('/animations',requireAuth,(_req,res)=>res.sendFile(fileURLToPath(new URL('./animations.html',import.meta.url))));
 const adapter={
  post(_url,_auth,handler){app.post('/api/animations/generate',access,(req,res,next)=>commerce.requireCreation(req,res,next),media,resourceProtection.run(handler));},
  get(url,_auth,handler){if(url!=='/api/admin/runway')return;app.get('/api/animations/status',access,resourceProtection.run(handler));}
 };
 installRunwayAdmin({app:adapter,requireAdmin:access,storage,decodeImage,fetchImpl,directoryName:'.runway-client-'+commerce.mode,
  beforeDownload:async(req,res)=>{let accepted=false;await media(req,res,()=>{accepted=true;res.locals.mediaProcessing=true;res.locals.clearUploadTimer?.();req.setTimeout?.(0);});return accepted;},
  beforeSubmit:async userId=>{const slot=await commerce.reserve({id:userId},'animations',1);if(!slot.ok)throw Error('Crédits animation insuffisants.');return slot.id;},
  settle:async(userId,job)=>{if(job.reservationId&&['FAILED','CANCELED','NOT_SUBMITTED'].includes(job.status))await pool.query('DELETE FROM olyvex_animation_usage WHERE id=$1 AND user_id=$2',[job.reservationId,userId]);}
 });
}
