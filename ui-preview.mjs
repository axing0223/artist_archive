// 只服务当前分支 app/ 和演示脚本；不暴露数据、Git 元信息或任意本地文件。
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),app=path.join(root,'app');
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 const demo=u.pathname==='/__demo.js',p=demo?path.join(root,'tools/ui-demo.js'):path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/app/index.html':u.pathname));
 if(!demo&&!p.startsWith(app+path.sep)){res.writeHead(403).end();return;}
 let content=await fs.readFile(p);if(p===path.join(app,'index.html')&&u.searchParams.get('demo')==='1')content=content.toString().replace('</head>','<script src="/__demo.js" defer></script></head>');
 res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');
 res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'none'; img-src 'self' blob: data:; base-uri 'none'; connect-src 'self'");res.end(content);
 }catch{res.writeHead(404).end();}
});server.listen(Number(process.env.PORT)||4175,'127.0.0.1',()=>console.log('分支预览：http://127.0.0.1:'+server.address().port+'/app/index.html?demo=1'));
