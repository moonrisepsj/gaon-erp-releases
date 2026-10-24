import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const exists=file=>access(file).then(()=>true,()=>false);
const normalize=file=>file.split(path.sep).join('/');

async function releasePackage(){
 const local=path.join(root,'package.json'),template=path.join(root,'docs/windows-release.package.json');
 const localValue=JSON.parse(await readFile(local,'utf8'));
 const file=localValue.name==='gaon-erp-windows'?local:template;
 return {file,value:JSON.parse(await readFile(file,'utf8'))};
}

function localReferences(source,extension){
 const references=[];
 if(['.mjs','.js','.cjs'].includes(extension)){
  const imports=/\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for(const match of source.matchAll(imports))if((match[1]||match[2]).startsWith('.'))references.push(match[1]||match[2]);
  for(const match of source.matchAll(/path\.join\(\s*here\s*,\s*['"]([^'"]+)['"]\s*\)/g))references.push('./'+match[1]);
  for(const match of source.matchAll(/path\.join\(\s*app\.getAppPath\(\)\s*,\s*['"](app\/[^'"]+)['"]\s*\)/g))references.push('../'+match[1]);
 }
 if(extension==='.html')for(const match of source.matchAll(/\b(?:src|href)=['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))references.push(match[1]);
 return references;
}

async function runtimeClosure(entry){
 const pending=[entry],seen=new Set();
 while(pending.length){
  const relative=normalize(pending.pop());
  if(seen.has(relative))continue;
  const absolute=path.join(root,relative);
  assert.equal(await exists(absolute),true,`Runtime dependency does not exist: ${relative}`);
  seen.add(relative);
  const source=await readFile(absolute,'utf8');
  for(const reference of localReferences(source,path.extname(relative))){
   const resolved=normalize(path.relative(root,path.resolve(path.dirname(absolute),reference)));
   assert.equal(resolved.startsWith('../'),false,`Runtime dependency escapes package root: ${reference}`);
   pending.push(resolved);
  }
 }
 return seen;
}

test('Windows release files exactly cover the desktop runtime dependency closure',async()=>{
 const {file,value}=await releasePackage();
 assert.equal(value.main,'app/desktop-client-main.mjs');
 assert.ok(Array.isArray(value.build?.files),'Windows release build.files is required');
 const packaged=new Set(value.build.files.map(normalize));
 assert.equal(packaged.has('package.json'),true,'package.json must be packaged');
 const runtime=await runtimeClosure(value.main);
 const packagedRuntime=new Set([...packaged].filter(item=>item.startsWith('app/')));
 assert.deepEqual([...packagedRuntime].sort(),[...runtime].sort(),`${path.relative(root,file)} build.files must match the desktop runtime dependency closure`);
});

test('cloud wrapper preserves legacy login and explicitly registers the Google callback',async()=>{
 const {value}=await releasePackage(),main=await readFile(path.join(root,'app/desktop-client-main.mjs'),'utf8'),policy=await readFile(path.join(root,'app/desktop-client-policy.mjs'),'utf8');
 assert.equal('electron-updater' in {...value.dependencies,...value.devDependencies},false);
 assert.doesNotMatch(main+policy,/\b(?:autoUpdater|checkForUpdates|setFeedURL)\b/);
 assert.match(main,/\/api\/gaon\/auth\/desktop\/'\+endpoint/);assert.match(main,/postAuth\('start'/);assert.match(main,/postAuth\('claim'/);assert.match(main,/\/healthz/);
 assert.deepEqual(value.build.protocols,[{name:'GAON 직원 로그인',schemes:['studio.keelson.gaon']}]);
 assert.match(main,/desktopCloudOrigin/);assert.equal(value.build.files.includes('app/desktop-cloud-session.mjs'),true);
 assert.equal(value.build.nsis.deleteAppDataOnUninstall,false);
 assert.equal(value.build.files.includes('desktop-client-config.json'),false);
});
