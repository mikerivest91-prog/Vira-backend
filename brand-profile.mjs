export function validateBrand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Identité invalide.');
  const brand = {};
  for (const [field, limit] of Object.entries({ name:100, tagline:160, email:254, phone:40, address:240, website:300 })) {
    if (value[field] != null && typeof value[field] !== 'string') throw Error('Champ invalide.');
    brand[field] = (value[field] || '').trim();
    if (brand[field].length > limit) throw Error('Un champ est trop long.');
  }
  if (brand.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brand.email)) throw Error('Courriel invalide.');
  if (brand.website) { const url = new URL(brand.website); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw Error('Adresse web invalide.'); }
  for (const field of ['primaryColor','secondaryColor']) { brand[field] = value[field] || (field==='primaryColor'?'#7444d5':'#263249'); if (!/^#[a-f0-9]{6}$/i.test(brand[field])) throw Error('Couleur invalide.'); }
  brand.logo = value.logo || '';
  if (typeof brand.logo !== 'string' || brand.logo.length > 500000 || (brand.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(brand.logo))) throw Error('Logo invalide. Importez une image PNG, JPEG ou WebP.');
  return brand;
}
export function installBrandProfile({app,pool,requireAuth}) {
  const read = async userId => (await pool.query('SELECT profile FROM vira_brand_profiles WHERE user_id=$1',[userId])).rows[0]?.profile || null;
  app.get('/api/brand',requireAuth,async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json({brand:await read(req.user.id)});}catch{res.status(503).json({error:'Identité indisponible.'});}});
  app.put('/api/brand',requireAuth,async(req,res)=>{res.setHeader('Cache-Control','no-store');let brand;try{brand=validateBrand(req.body);}catch(error){return res.status(400).json({error:error.message});}try{await pool.query('INSERT INTO vira_brand_profiles(user_id,profile) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=NOW()',[req.user.id,JSON.stringify(brand)]);res.json({brand});}catch{res.status(503).json({error:'Enregistrement impossible. Réessayez.'});}});
  return {read,async init(){await pool.query('CREATE TABLE IF NOT EXISTS vira_brand_profiles(user_id BIGINT PRIMARY KEY REFERENCES vira_users(id) ON DELETE CASCADE,profile JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');}};
}

