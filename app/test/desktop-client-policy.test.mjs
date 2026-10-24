import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeServerURL,clientURLAction,trustedClientHealth,trustedClientStatus,trustedClientDownload,clientWebPreferences} from '../desktop-client-policy.mjs';

const origin='https://erp.example.com';
const webApp='https://gaon-erp-keelson.web.app';
test('server setup accepts only a bare public HTTPS origin',()=>{
 assert.equal(normalizeServerURL('  https://erp.example.com/  '),origin);
 assert.equal(normalizeServerURL(webApp+'/'),webApp);
 for(const value of ['http://erp.example.com','https://user:pass@erp.example.com','https://erp.example.com:444','https://erp.example.com/erp/','https://erp.example.com/?next=x','https://localhost','https://studio.local','not a URL'])assert.throws(()=>normalizeServerURL(value));
});
test('web.app is a valid saved base but navigation keeps cloud auth and file URLs within its origin',()=>{
 assert.equal(clientURLAction(webApp+'/erp/home.html#today',webApp),'internal');
 assert.equal(clientURLAction(webApp+'/api/gaon/auth/login?returnTo=%2Ferp%2Fhome.html',webApp),'login');
 assert.equal(clientURLAction(webApp+'/api/gaon/statements?id=fake&format=pdf',webApp),'deny');
 assert.equal(clientURLAction('https://accounts.google.com/o/oauth2/v2/auth',webApp),'external');
 assert.equal(trustedClientDownload('blob:'+webApp+'/fixture',webApp),true);
 assert.equal(trustedClientDownload(webApp+'/api/gaon/integration-requests.xlsx',webApp),true);
});
test('top-level navigation stays within ERP pages and fixed auth handoffs',()=>{
 assert.equal(clientURLAction(origin+'/erp/home.html#today',origin),'internal');
 assert.equal(clientURLAction(origin+'/api/gaon/auth/login?desktop=x',origin),'login');
 assert.equal(clientURLAction(origin+'/api/gaon/drive/connect',origin),'drive');
 for(const url of [origin+'/api/gaon/payroll',origin+'/welcome.html','http://erp.example.com/erp/home.html','file:///etc/passwd','javascript:alert(1)','https://user:pass@outside.example'])assert.equal(clientURLAction(url,origin),'deny');
 assert.equal(clientURLAction('https://accounts.google.com/o/oauth2/auth',origin),'external');
});
test('server identity, staff status, downloads and renderer flags are narrow',()=>{
 assert.equal(trustedClientHealth({status:'ok',service:'gaon-erp',desktopProtocol:1}),true);
 assert.equal(trustedClientHealth({status:'ok',service:'other',desktopProtocol:1}),false);
 assert.equal(trustedClientStatus({signedIn:true,role:'staff'}),true);
 assert.equal(trustedClientStatus({signedIn:true}),false);
 assert.equal(trustedClientDownload(origin+'/api/export.xlsx',origin),true);
 assert.equal(trustedClientDownload('blob:'+origin+'/uuid',origin),true);
 assert.equal(trustedClientDownload('https://outside.example/a.xlsx',origin),false);
 assert.deepEqual({nodeIntegration:clientWebPreferences.nodeIntegration,contextIsolation:clientWebPreferences.contextIsolation,sandbox:clientWebPreferences.sandbox,webSecurity:clientWebPreferences.webSecurity},{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
});

// Desktop public-cloud flows use synthetic credentials and in-memory storage only.
import {createDesktopCloudSession,createDesktopCredentialStore,desktopOAuthCallback,desktopCallbackCode,desktopCloudPath,desktopCloudReply} from '../desktop-cloud-session.mjs';
const cloudFixture=()=>{
 let token=null,refreshes=0,exchanges=0,businessStatus=200,businessBody={saved:true},staffAllowed=true;
 const calls=[],store={read:async()=>token,write:async v=>{token=v;},remove:async()=>{token=null;}};
 const session={accessToken:'FAKE_ACCESS_ONLY',refreshToken:'FAKE_REFRESH_ONLY',expiresAt:Date.now()+3600000};
 const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/auth/refresh')){refreshes++;return Response.json(session);}if(url.endsWith('/auth/exchange')){exchanges++;return Response.json(session);}if(url.endsWith('/auth/status'))return options.headers.Authorization?(staffAllowed?Response.json({signedIn:true,role:'staff',actor:{id:'fake-employee'}}):Response.json({error:'not admitted'},{status:403})):Response.json({signedIn:false,googleEnabled:true});return Response.json(businessBody,{status:businessStatus});};
 return {store,calls,fetcher,get token(){return token;},get refreshes(){return refreshes;},get exchanges(){return exchanges;},seed:v=>token=v,rejectStaff:()=>staffAllowed=false,reply:(status,body)=>{businessStatus=status;businessBody=body;}};
};
test('desktop OAuth uses PKCE/system-browser callback; renderer receives no session credential',async()=>{
 const f=cloudFixture(),auth=createDesktopCloudSession(f);const url=new URL(await auth.begin());assert.equal(url.searchParams.get('redirect_to'),desktopOAuthCallback);assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert(!url.searchParams.has('code_verifier'));
 const status=await auth.complete(desktopOAuthCallback+'?code=FAKE_CODE');assert.equal(status.actor.id,'fake-employee');assert(!JSON.stringify(status).includes('FAKE_ACCESS_ONLY'));assert.equal(f.token,'FAKE_REFRESH_ONLY');await assert.rejects(auth.complete(desktopOAuthCallback+'?code=FAKE_CODE'));assert.equal(f.exchanges,1);
});
test('desktop login refuses unregistered staff before persisting refresh credentials',async()=>{
 const f=cloudFixture(),auth=createDesktopCloudSession(f);await auth.begin();f.rejectStaff();await assert.rejects(auth.complete(desktopOAuthCallback+'?code=FAKE_CODE'),/직원/);assert.equal(f.token,null);
});
test('desktop restart restores one session refresh for concurrent business calls',async()=>{
 const f=cloudFixture();f.seed('FAKE_OLD_REFRESH');const auth=createDesktopCloudSession(f);await Promise.all([auth.request({path:'/api/gaon/buildings'}),auth.request({path:'/api/gaon/home'})]);assert.equal(f.refreshes,1);assert.equal(f.token,'FAKE_REFRESH_ONLY');for(const call of f.calls.filter(c=>/\/(?:buildings|home)$/.test(c.url)))assert.equal(call.options.headers.Authorization,'Bearer FAKE_ACCESS_ONLY');
});
test('desktop denies API escapes, token endpoints, injected headers and invalid bodies',async()=>{
 const f=cloudFixture(),auth=createDesktopCloudSession(f);
 for(const path of ['https://evil.test/api/gaon/home','//evil.test/api/gaon/home','/api/gaon/../auth','/api/gaon/%2e%2e/home','/api/gaon/auth/exchange','/api/gaon/auth/refresh','/api/gaon/home#x'])assert.throws(()=>desktopCloudPath(path));
 for(const input of [{path:'/api/gaon/home',headers:{Authorization:'stolen'}},{path:'/api/gaon/home',method:'TRACE'},{path:'/api/gaon/home',headers:{accept:'a\r\nb'}},{path:'/api/gaon/home',body:'not-get-body'}])await assert.rejects(auth.request(input));assert.equal(f.calls.length,0);
});
test('failed logout preserves protected session for retry; success removes it',async()=>{
 const f=cloudFixture();f.seed('FAKE_OLD_REFRESH');const auth=createDesktopCloudSession(f);await auth.status();f.reply(503,{error:'retry'});assert.equal((await auth.request({path:'/api/gaon/auth/logout',method:'POST'})).status,503);assert.equal(f.token,'FAKE_REFRESH_ONLY');f.reply(200,{signedOut:true});await auth.request({path:'/api/gaon/auth/logout',method:'POST'});assert.equal(f.token,null);
});
test('business denial preserves sign-in, staff admission revocation clears it',async()=>{
 const f=cloudFixture();f.seed('FAKE_OLD_REFRESH');const auth=createDesktopCloudSession(f);await auth.status();f.reply(403,{error:'action denied'});assert.equal((await auth.request({path:'/api/gaon/operations'})).status,403);assert.equal(f.token,'FAKE_REFRESH_ONLY');f.reply(403,{code:'STAFF_ACCESS_DENIED'});assert.equal((await auth.request({path:'/api/gaon/operations'})).status,401);assert.equal(f.token,null);
});
test('desktop callback rejects other apps, duplicate codes and token fragments',()=>{
 for(const value of ['https://example.test/?code=x',desktopOAuthCallback+'?code=x&code=y',desktopOAuthCallback+'?access_token=x',desktopOAuthCallback+'?code=x#refresh_token=y','studio.keelson.gaon://user@auth/callback?code=x'])assert.throws(()=>desktopCallbackCode(value));assert.throws(()=>desktopCallbackCode(desktopOAuthCallback+'?error=access_denied&error_description=PRIVATE'),e=>!e.message.includes('PRIVATE'));
});
test('credential store writes encrypted bytes only and fails closed without OS protection',async()=>{
 const files=new Map(),fs={readFile:async p=>{if(!files.has(p))throw Object.assign(Error(),{code:'ENOENT'});return files.get(p);},writeFile:async(p,bytes)=>files.set(p,bytes),rename:async(a,b)=>{files.set(b,files.get(a));files.delete(a);},rm:async p=>files.delete(p)};
 const safeStorage={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async()=>Buffer.from('ENCRYPTED'),decryptStringAsync:async()=>({result:'FAKE_REFRESH',shouldReEncrypt:false})};
 const vault=createDesktopCredentialStore({file:'session.bin',safeStorage,fs});assert.equal(await vault.read(),null);await vault.write('FAKE_REFRESH');assert.equal(files.get('session.bin').toString(),'ENCRYPTED');assert.equal(await vault.read(),'FAKE_REFRESH');await vault.remove();assert.equal(files.size,0);
 const unavailable=createDesktopCredentialStore({file:'session.bin',safeStorage:{isAsyncEncryptionAvailable:async()=>false},fs});await assert.rejects(unavailable.write('FAKE_REFRESH'));assert.equal(files.size,0);
});
test('desktop response bridge returns only allowed headers and retains binary downloads',async()=>{
 const result=await desktopCloudReply(new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'application/pdf','Set-Cookie':'PRIVATE','Authorization':'PRIVATE'}}));assert.deepEqual([...result.body],[1,2,3]);assert.equal(result.headers['content-type'],'application/pdf');assert(!JSON.stringify(result.headers).includes('PRIVATE'));
});

test('cloud renderer network stays within GAON and local preview assets',async()=>{
 const {cloudRendererNetworkAllowed:allow}=await import('../desktop-client-policy.mjs');const origin='https://gaon-erp-keelson.web.app';
 assert.equal(allow(origin+'/erp/home.html',origin),true);assert.equal(allow('blob:'+origin+'/fixture',origin),true);assert.equal(allow('data:image/png;base64,AA==',origin),true);
 for(const url of ['https://outside.example/?private=fixture','http://gaon-erp-keelson.web.app','https://gaon-erp-keelson.web.app.evil.example','file:///private.txt'])assert.equal(allow(url,origin),false);
});
test('response byte limit rejects a declared oversized download before reading',async()=>{
 let pulled=false,cancelled=false;const stream=new ReadableStream({pull(){pulled=true;},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(desktopCloudReply(new Response(stream,{headers:{'content-length':String(49*1024*1024)}})),e=>e.status===413);assert.equal(pulled,false);assert.equal(cancelled,true);
});
