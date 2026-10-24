import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url),executablePath=require('electron');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),profile=await mkdtemp(path.join(os.tmpdir(),'gaon-desktop-client-'));
try{
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(executablePath,[path.join(root,'app/desktop-client-main.mjs')],{cwd:root,env:{...process.env,GAON_DESKTOP_TEST_USER_DATA:profile,GAON_DESKTOP_SMOKE:'1'},stdio:['ignore','pipe','pipe']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Electron setup smoke timed out'));},30000);
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error(output||`Electron exited ${code}`));const line=output.split('\n').find(value=>value.startsWith('__GAON_DESKTOP_SMOKE__'));if(!line)return reject(Error('Smoke result missing\n'+output));resolve(JSON.parse(line.slice('__GAON_DESKTOP_SMOKE__'.length)));});
 });
 assert.deepEqual({serverOrigin:result.state.serverOrigin,connected:result.state.connected,signedIn:result.state.signedIn},{serverOrigin:'https://gaon-erp-keelson.web.app',connected:false,signedIn:false});
 assert.deepEqual(result.bridge,{version:1,denied:true});
 if(process.platform==='win32')assert.deepEqual(result.protectedStorage,{roundTrip:true,encrypted:true});
 assert.deepEqual(result.security,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
 console.log(JSON.stringify({setup:true,ipc:true,cloudBridge:result.bridge,protectedStorage:result.protectedStorage,security:result.security}));
}finally{await rm(profile,{recursive:true,force:true});}
