import {app,BrowserWindow,Menu,dialog,ipcMain,shell,session} from 'electron';
import {readFile,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {clientWebPreferences,normalizeServerURL,clientURLAction,trustedClientHealth,trustedClientStatus,trustedClientDownload} from './desktop-client-policy.mjs';

app.setName('GAON ERP');
const here=path.dirname(fileURLToPath(import.meta.url)),setupFile=path.join(here,'desktop-client-setup.html'),setupURL=pathToFileURL(setupFile).href;
const partition='persist:gaon-erp-client';
let window,manualWindow,serverOrigin='',connected=false,signedIn=false,loginBusy=false,quitting=false,statePath,statusMessage='',locationGranted=false;
if(!app.isPackaged&&process.env.GAON_DESKTOP_TEST_USER_DATA)app.setPath('userData',path.resolve(process.env.GAON_DESKTOP_TEST_USER_DATA));
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',focus);
 app.on('activate',()=>window?focus():start().catch(fail));
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;});
 app.whenReady().then(start).catch(fail);
}
const ses=()=>session.fromPartition(partition);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function focus(){if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();}
async function fail(error){await dialog.showMessageBox({type:'error',title:'GAON ERP',message:'앱을 열지 못했습니다.',detail:error.message});app.quit();}
async function start(){
 statePath=path.join(app.getPath('userData'),'server.json');
 serverOrigin=await readConfiguredServer();
 configureSession();configureIPC();setMenu();createWindow();
 if(!serverOrigin)return showSetup('관리자가 안내한 ERP 서버 주소를 입력해 주세요.');
 try{await verifyServer();signedIn=await verifySession();if(signedIn)return openERP();return showSetup('서버 연결을 확인했습니다. 직원 로그인을 완료해 주세요.');}
 catch(error){return showSetup(error.message);}
}
async function readConfiguredServer(){
 for(const file of [statePath,path.join(app.getAppPath(),'desktop-client-config.json')])try{const value=normalizeServerURL(JSON.parse(await readFile(file,'utf8')).serverOrigin);return value;}catch{}
 return '';
}
function createWindow(){
 window=new BrowserWindow({title:'GAON ERP',width:1180,height:820,minWidth:880,minHeight:600,show:false,backgroundColor:'#eef3f7',webPreferences:{...clientWebPreferences,partition,preload:path.join(here,'desktop-client-preload.cjs')}});
 const wc=window.webContents;
 const navigate=(event,legacy)=>{const url=event.url||legacy;if(url===setupURL)return;const action=clientURLAction(url,serverOrigin);if(action==='internal'&&signedIn)return;event.preventDefault();routeURL(url,action);};
 wc.on('will-navigate',navigate);wc.on('will-redirect',navigate);wc.on('will-attach-webview',event=>event.preventDefault());
 wc.setWindowOpenHandler(({url})=>{routeURL(url,clientURLAction(url,serverOrigin));return {action:'deny'};});
 wc.on('page-title-updated',event=>{event.preventDefault();window?.setTitle('GAON ERP');});
 wc.on('render-process-gone',()=>{if(!quitting)showSetup('화면 연결이 종료됐습니다. 다시 열어 주세요.');});
 window.once('ready-to-show',focus);
}
function setupSender(event){if(event.sender!==window?.webContents||event.senderFrame?.url!==setupURL)throw Error('허용되지 않은 화면입니다.');}
function configureIPC(){
 ipcMain.handle('gaon-client:state',event=>{setupSender(event);return {serverOrigin,connected,signedIn,message:statusMessage||(connected?(signedIn?'직원 로그인이 확인됐습니다.':'서버 연결을 확인했습니다. 직원 로그인을 완료해 주세요.'):(serverOrigin?'서버 연결을 확인할 수 없습니다. 주소와 서버 상태를 확인해 주세요.':'관리자가 안내한 ERP 서버 주소를 입력해 주세요.'))};});
 ipcMain.handle('gaon-client:save-server',async(event,value)=>{setupSender(event);if(loginBusy)throw Error('직원 로그인 진행 중에는 서버 주소를 바꿀 수 없습니다.');const next=normalizeServerURL(value);await verifyServer(next);if(next!==serverOrigin)locationGranted=false;serverOrigin=next;connected=true;signedIn=await verifySession();statusMessage=signedIn?'직원 로그인이 확인됐습니다. ERP를 열 수 있습니다.':'서버 연결을 확인했습니다. 직원 로그인을 진행해 주세요.';await writeFile(statePath,JSON.stringify({serverOrigin})+'\n',{mode:0o600});return {serverOrigin,connected,signedIn,message:statusMessage};});
 ipcMain.handle('gaon-client:login',async event=>{setupSender(event);await beginLogin();return {message:'직원 로그인이 완료됐습니다.'};});
 ipcMain.handle('gaon-client:open-app',async event=>{setupSender(event);if(!await verifySession())throw Error('직원 로그인이 필요합니다.');await openERP();return {opened:true};});
 ipcMain.handle('gaon-client:forget-server',async event=>{setupSender(event);if(loginBusy)throw Error('직원 로그인 진행 중에는 서버 주소를 지울 수 없습니다.');const old=serverOrigin;serverOrigin='';connected=false;signedIn=false;locationGranted=false;statusMessage='저장한 서버 주소를 지웠습니다.';await rm(statePath,{force:true});if(old)await ses().clearStorageData({origin:old});return {cleared:true};});
 ipcMain.handle('gaon-client:manual',async event=>{setupSender(event);await openManual();return {opened:true};});
}
function configureSession(){
 const current=ses();
 current.setPermissionRequestHandler(async(webContents,permission,callback,details)=>{
  const requestingOrigin=(()=>{try{return new URL(details?.requestingUrl||webContents.getURL()).origin;}catch{return '';}})();
  if(permission!=='geolocation'||webContents!==window?.webContents||!signedIn||!serverOrigin||requestingOrigin!==serverOrigin)return callback(false);
  const result=await dialog.showMessageBox(window,{type:'question',title:'GAON ERP · 위치 사용',message:'출퇴근 위치 확인을 위해 현재 위치 사용을 허용할까요?',detail:'위치 정보는 연결한 GAON ERP 서버의 출퇴근 기능에서만 사용합니다.',buttons:['허용','허용 안 함'],defaultId:1,cancelId:1});
  locationGranted=result.response===0;callback(locationGranted);
 });
 current.setPermissionCheckHandler((webContents,permission,requestingOrigin)=>webContents===window?.webContents&&permission==='geolocation'&&signedIn&&locationGranted&&requestingOrigin===serverOrigin);
 current.on('will-download',(event,item,contents)=>{if(!contents||!trustedClientDownload(item.getURL(),serverOrigin)){event.preventDefault();return;}item.setSaveDialogOptions({title:'GAON ERP · 파일 저장',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
}
async function verifyServer(origin=serverOrigin){
 const response=await ses().fetch(origin+'/healthz',{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)}).catch(()=>null);
 if(!response?.ok||!trustedClientHealth(await response.json().catch(()=>null)))throw Error('GAON ERP 서버를 확인할 수 없습니다. HTTPS 주소와 서버 상태를 확인해 주세요.');
 connected=true;return true;
}
async function verifySession(){
 if(!serverOrigin)return false;
 const response=await ses().fetch(serverOrigin+'/api/gaon/auth/status',{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)}).catch(()=>null);
 signedIn=!!response?.ok&&trustedClientStatus(await response.json().catch(()=>null));return signedIn;
}
async function postAuth(endpoint,body){return ses().fetch(serverOrigin+'/api/gaon/auth/desktop/'+endpoint,{method:'POST',headers:{Origin:serverOrigin,'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
async function beginLogin(purpose='login'){
 if(loginBusy)throw Error('이미 직원 로그인을 기다리고 있습니다.');
 await verifyServer();loginBusy=true;window?.setProgressBar(2);
 try{
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const response=await postAuth('start',{challenge,purpose});if(!response.ok)throw Error('직원 로그인 연결을 시작하지 못했습니다.');
  const flow=await response.json(),maxExpiry=Date.now()+10*60*1000;
  if(!/^[A-Za-z0-9_-]{43}$/.test(flow.id)||flow.loginPath!==`/api/gaon/auth/login?desktop=${flow.id}`||!Number.isFinite(flow.expires)||flow.expires<=Date.now()||flow.expires>maxExpiry)throw Error('서버의 로그인 응답을 확인할 수 없습니다.');
  await shell.openExternal(serverOrigin+flow.loginPath);
  while(Date.now()<flow.expires&&!quitting){
   await delay(1000);const claim=await postAuth('claim',{id:flow.id,verifier});
   if(claim.status===202)continue;if(!claim.ok)throw Error('직원 로그인 연결이 만료됐습니다. 다시 시도해 주세요.');
   const statusResponse=await ses().fetch(serverOrigin+'/api/gaon/auth/status',{cache:'no-store',signal:AbortSignal.timeout(10000)}).catch(()=>null);
   if(!statusResponse?.ok||!trustedClientStatus(await statusResponse.json().catch(()=>null)))throw Error('직원 권한을 확인하지 못했습니다.');
   signedIn=true;if(purpose==='login')await openERP();else window?.webContents.reload();return;
  }
  throw Error('로그인 시간이 초과됐습니다. 다시 시도해 주세요.');
 }finally{loginBusy=false;if(window&&!window.isDestroyed())window.setProgressBar(-1);}
}
async function showSetup(message=''){
 statusMessage=message;await window.loadFile(setupFile);focus();
 if(!app.isPackaged&&process.env.GAON_DESKTOP_SMOKE==='1'){
  const state=await window.webContents.executeJavaScript('window.gaonDesktop.state()'),preferences=window.webContents.getLastWebPreferences();
  console.log('__GAON_DESKTOP_SMOKE__'+JSON.stringify({state,security:{nodeIntegration:preferences.nodeIntegration,contextIsolation:preferences.contextIsolation,sandbox:preferences.sandbox,webSecurity:preferences.webSecurity}}));
  setImmediate(()=>app.quit());
 }
}
async function openERP(){if(!serverOrigin||!signedIn)throw Error('직원 로그인이 필요합니다.');await window.loadURL(serverOrigin+'/erp/home.html#today');focus();}
function routeURL(url,action=clientURLAction(url,serverOrigin)){if(action==='login'||action==='drive')beginLogin(action==='drive'?'drive':'login').catch(error=>dialog.showMessageBox({type:'warning',title:'직원 로그인',message:error.message}));else if(action==='external')shell.openExternal(url).catch(()=>{});else if(action==='internal'&&signedIn)window?.loadURL(url);}
async function openManual(){
 const file=path.join(app.getAppPath(),'app/desktop-client-manual.html');if(!await access(file).then(()=>true,()=>false)){await dialog.showMessageBox(window,{title:'빠른 사용 안내',message:'1. 관리자가 안내한 HTTPS 서버 주소를 입력합니다.\n2. 직원 로그인을 누르고 기본 브라우저에서 로그인합니다.\n3. 로그인 완료 후 앱으로 돌아오면 ERP가 열립니다.',detail:'서버 주소 변경이 필요하면 도움말 메뉴에서 연결 설정을 여세요.'});return;}
 if(manualWindow&&!manualWindow.isDestroyed()){manualWindow.focus();return;}manualWindow=new BrowserWindow({title:'GAON ERP 빠른 사용 안내',width:820,height:720,parent:window,webPreferences:clientWebPreferences});await manualWindow.loadFile(file);
}
function setMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'파일',submenu:[{label:'직원 로그인',click:()=>beginLogin().catch(error=>dialog.showMessageBox({type:'warning',message:error.message}))},{label:'연결 설정',click:()=>showSetup()},{type:'separator'},{role:'quit',label:'종료'}]},{label:'보기',submenu:[{role:'reload',label:'새로고침'},{role:'resetZoom',label:'실제 크기'},{role:'zoomIn',label:'확대'},{role:'zoomOut',label:'축소'},{role:'togglefullscreen',label:'전체 화면'}]},{label:'도움말',submenu:[{label:'빠른 사용 안내',click:openManual},{label:'브라우저에서 열기',click:()=>{if(serverOrigin&&signedIn)shell.openExternal(serverOrigin+'/erp/home.html#today');}}]}]));}
