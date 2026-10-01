import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Paid pilot: server-authorized administrator only; no automatic POST retries.
export function installRunwayAdmin({app, requireAdmin, storage, decodeImage, fetchImpl = fetch}) {
  const directory = path.join(storage, '.runway-jobs');
  const locked = new Set();
  const jobFile = user => path.join(directory, crypto.createHash('sha256').update(String(user)).digest('hex') + '.json');
  const read = async user => { try { return JSON.parse(await fs.readFile(jobFile(user), 'utf8')); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } };
  const save = async (user, job) => {
    await fs.mkdir(directory, {recursive:true});
    const file = jobFile(user);
    await fs.writeFile(file + '.tmp', JSON.stringify(job), {mode:0o600});
    await fs.rename(file + '.tmp', file);
  };
  const api = async (route, body) => {
    const key = process.env.RUNWAYML_API_SECRET;
    if(!key) throw new Error('Clé Runway absente dans Render.');
    const response = await fetchImpl('https://api.dev.runwayml.com/v1/' + route, {
      method: body ? 'POST' : 'GET', signal:AbortSignal.timeout(45000),
      headers:{Authorization:'Bearer '+key, 'X-Runway-Version':'2024-11-06', 'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    if(!response.ok) throw new Error('Runway a répondu HTTP '+response.status+'. Vérifiez le compte Runway avant de réessayer.');
    return response.json();
  };
  const guard = handler => async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const user = String(req.user.id);
    if(locked.has(user)) return res.status(409).json({error:'Une opération est en cours.'});
    locked.add(user);
    try { await handler(req,res,user); }
    catch { res.status(502).json({error:'Opération interrompue. Consultez le statut : ne relancez pas une génération payante.'}); }
    finally { locked.delete(user); }
  };
  app.get('/animation-ia', requireAdmin, (_req,res) => res.sendFile(path.resolve('animation-ia.html')));
  app.post('/api/admin/runway', requireAdmin, guard(async (req,res,user) => {
    const origin=req.get('origin');
    if(!origin || new URL(origin).host!==req.get('host')) return res.status(403).json({error:'Ouvrez ce test depuis Olyvex.'});
    if(!process.env.RUNWAYML_API_SECRET) return res.status(503).json({error:'Clé Runway absente dans Render.'});
    if(req.body?.confirmPaid !== true) return res.status(400).json({error:'Confirmez le coût du test.'});
    const prompt = req.body?.prompt;
    if(typeof prompt !== 'string' || !prompt.trim() || prompt.length>900) return res.status(400).json({error:'Décrivez le mouvement (900 caractères maximum).'});
    try { decodeImage(req.body.image, 0); } catch { return res.status(400).json({error:'Image JPEG ou PNG invalide (1 Mo maximum).'}); }
    const previous = await read(user);
    if(previous && !['SUCCEEDED','FAILED','CANCELED'].includes(previous.status)) return res.status(409).json({error:'Un test existe déjà. Consultez son statut avant de continuer.'});
    // Persist before submitting: an ambiguous network failure must never auto-charge again.
    const job = {status:'SUBMITTING', createdAt:new Date().toISOString(), localId:crypto.randomUUID()};
    await save(user,job);
    try {
      const result = await api('image_to_video',{model:'gen4_turbo',promptImage:req.body.image,promptText:prompt.trim(),ratio:'720:1280',duration:5});
      if(typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.id)) throw new Error('Invalid task');
      job.id=result.id; job.status='PENDING'; await save(user,job);
    } catch { job.status='UNKNOWN'; await save(user,job); }
    res.status(202).json(job);
  }));
  app.get('/api/admin/runway', requireAdmin, guard(async (_req,res,user) => {
    const job = await read(user);
    if(!job) return res.json({status:'IDLE'});
    if(job.videoUrl || !job.id || ['FAILED','CANCELED'].includes(job.status)) return res.json(job);
    const task = await api('tasks/'+encodeURIComponent(job.id));
    job.status = task.status;
    if(task.status === 'SUCCEEDED') {
      const url = new URL(task.output?.[0]);
      // Accept only provider-owned media hosts, never arbitrary user URLs or redirects.
      if(url.protocol!=='https:' || !(url.hostname==='dnznrvs05pmza.cloudfront.net' || url.hostname.endsWith('.runwayml.com') || url.hostname.endsWith('.runway.com'))) throw new Error('Untrusted media host');
      const response = await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(120000)});
      if(!response.ok || !response.body) throw new Error('Download failed');
      const name='vira-runway-'+job.localId+'.mp4';
      const target=path.join(storage,name), temporary=target+'.part';
      const handle=await fs.open(temporary,'w');
      try {
        let size=0;
        for await (const chunk of response.body) {
          size+=chunk.length; if(size>80*1024*1024) throw new Error('Video too large');
          await handle.writeFile(chunk);
        }
        if(!size) throw new Error('Empty video');
      } catch(e) { await handle.close(); await fs.unlink(temporary).catch(()=>{}); throw e; }
      await handle.close();
      await fs.writeFile(target+'.owner.json',JSON.stringify({userId:user}));
      await fs.rename(temporary,target);
      job.videoUrl='/videos/'+name;
    }
    await save(user,job); res.json(job);
  }));
}
