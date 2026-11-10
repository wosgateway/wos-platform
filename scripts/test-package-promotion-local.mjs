import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=mkdtempSync(path.join(tmpdir(),'wos-promotion-docker-'));
const host=process.platform==='win32'?'npipe:////./pipe/docker_engine':'unix:///var/run/docker.sock';
const args=['--host',host,'--config',config];
const token=randomUUID();let container;
const docker=(tail,input)=>{
 const result=spawnSync('docker',[...args,...tail],{input,encoding:'utf8',timeout:30000});
 if(result.status!==0)throw Error(result.stderr||String(result.error));return result.stdout.trim();
};
try {
 // Cached images only: never pull, inspect existing containers, or use remote Docker contexts.
 const image=docker(['image','inspect',process.env.WOS_PROMOTION_TEST_IMAGE||'pgvector/pgvector:pg16','--format','{{.Id}}']);
 container=docker(['run','--detach','--rm','--pull=never','--network','none','--tmpfs','/var/lib/postgresql/data','--label','wos.promotion.disposable='+token,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=wos_promotion_disposable',image]);
 let ready=false;
 for(let i=0;i<30;i++){
  try {docker(['exec',container,'pg_isready','-U','postgres','-d','wos_promotion_disposable']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}
 }
 if(!ready)throw Error('Disposable PostgreSQL did not become ready');
 const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','src/lib/package-promotion-rpc.local.test.ts','--maxWorkers=1','--minWorkers=1','--no-file-parallelism','--no-cache'],{
  cwd:root,stdio:'inherit',env:{...process.env,WOS_PROMOTION_LOCAL_CONTAINER:container,WOS_PROMOTION_LOCAL_TOKEN:token,WOS_PROMOTION_DOCKER_CONFIG:config},
 });
 process.exitCode=result.status??1;
} catch(error){console.error(error.message);process.exitCode=1;}
finally {if(container)docker(['stop',container]);if(path.dirname(config)!==tmpdir()||!path.basename(config).startsWith('wos-promotion-docker-'))throw Error('Unsafe cleanup target');rmSync(config,{recursive:true,force:true});}
