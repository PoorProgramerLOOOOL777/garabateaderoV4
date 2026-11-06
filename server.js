// Servidor de Garabateadero (sin dependencias). Uso: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const PORT=process.env.PORT||3000,ROOT=__dirname,DATA=path.join(ROOT,'data'),UP=path.join(ROOT,'uploads'),DB=path.join(DATA,'posts.json');
const MAX_POSTS=200,MAX_BODY=2e6,COOLDOWN=10000,CATS=['Caos','Fanart','Experimentos','Quejas existenciales'];
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(UP,{recursive:true});
let posts=[];try{posts=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
if(!Array.isArray(posts))posts=[];
// Se escribe en un archivo temporal y se renombra: si algo falla a mitad, posts.json no queda cortado.
const saveDB=()=>{fs.writeFileSync(DB+'.tmp',JSON.stringify(posts));fs.renameSync(DB+'.tmp',DB)},pub=({token,...p})=>p,last=new Map(),busy=new Set();
const fail=(status,msg)=>Object.assign(new Error(msg),{status});
const send=(res,code,obj)=>{if(res.headersSent)return res.end();res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let n=0,b=[],big=false;req.on('data',c=>{n+=c.length;if(big)return;if(n>MAX_BODY){big=true;b=[];no(fail(413,'Imagen demasiado grande'))}else b.push(c)});req.on('end',()=>{if(!big)try{const j=JSON.parse(Buffer.concat(b).toString()||'{}');ok(j&&typeof j==='object'?j:{})}catch{no(fail(400,'JSON inválido'))}});req.on('error',no)});
const server=http.createServer(async(req,res)=>{
 try{
  let p;try{p=decodeURIComponent(new URL(req.url,'http://x').pathname)}catch{throw fail(400,'Dirección inválida')}
  if(p==='/api/posts'&&req.method==='GET')return send(res,200,posts.map(pub));
  if(p==='/api/posts'&&req.method==='POST'){
   const ip=req.socket.remoteAddress,now=Date.now();
   // "busy" evita que dos envíos simultáneos (doble clic) se cuelen antes de anotar el tiempo de espera.
   if(busy.has(ip)||now-(last.get(ip)||0)<COOLDOWN)return send(res,429,{error:'Espera unos segundos antes de publicar otra obra.'});
   busy.add(ip);
   try{
    const b=await body(req),m=/^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(b.image||''),title=String(b.title||'').trim().slice(0,42);
    const img=m&&Buffer.from(m[1],'base64');
    if(!title||!img||img[0]!==0xFF||img[1]!==0xD8)return send(res,400,{error:'Falta el título o la imagen.'});
    const id='post-'+crypto.randomBytes(6).toString('hex'),token=crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(UP,id+'.jpg'),img);
    const post={id,token,title,author:String(b.author||'').trim().slice(0,22)||'Anónimo del lienzo',category:CATS.includes(b.category)?b.category:'Caos',caption:String(b.caption||'').trim().slice(0,120),image:'uploads/'+id+'.jpg',likes:0,created:now};
    posts.unshift(post);for(const o of posts.splice(MAX_POSTS))fs.rmSync(path.join(UP,o.id+'.jpg'),{force:true});
    saveDB();last.set(ip,now);for(const[k,t]of last)if(now-t>COOLDOWN)last.delete(k);
    return send(res,201,{...pub(post),token});
   }finally{busy.delete(ip)}
  }
  const mm=/^\/api\/posts\/([\w-]+)(\/like)?$/.exec(p);
  if(mm){
   const post=posts.find(x=>x.id===mm[1]);if(!post)return send(res,404,{error:'No existe esa obra.'});
   if(mm[2]&&req.method==='POST'){const b=await body(req);post.likes=Math.max(0,post.likes+(b.delta===-1?-1:1));saveDB();return send(res,200,{likes:post.likes})}
   if(!mm[2]&&req.method==='DELETE'){const b=await body(req);if(b.token!==post.token)return send(res,403,{error:'Solo quien publicó la obra puede eliminarla.'});posts=posts.filter(x=>x!==post);fs.rmSync(path.join(UP,post.id+'.jpg'),{force:true});saveDB();return send(res,200,{ok:true})}
  }
  const file=path.join(ROOT,p==='/'?'index.html':p),rel=path.relative(ROOT,file).split(path.sep).join('/');
  const allowed=/^[\w-]+\.html$/.test(rel)||/^(assets|uploads)\/[^/]/.test(rel);
  if(req.method!=='GET'||!allowed||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('No encontrado')}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(file).toLowerCase()]||'application/octet-stream'});
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
 }catch(e){const code=e.status||500;if(code===500)console.error(e);send(res,code,{error:code===500?'Error interno del servidor.':e.message})}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'\nEl puerto '+PORT+' ya está en uso. Cierra el otro servidor o usa otro puerto con la variable de entorno PORT.\n':e.message);process.exit(1)});
server.listen(PORT,'0.0.0.0',()=>{
 console.log('\nGarabateadero listo:\n  En este equipo:  http://localhost:'+PORT);
 for(const l of Object.values(os.networkInterfaces()))for(const i of l)if((i.family==='IPv4'||i.family===4)&&!i.internal)console.log('  En tu red local: http://'+i.address+':'+PORT);
 console.log('\nCtrl+C para detenerlo.\n');
});