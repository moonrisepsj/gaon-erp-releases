import {createHash} from 'node:crypto';
import path from 'node:path';
import {readFile,writeFile,rename,access} from 'node:fs/promises';
const uuid='[a-f\\d]{8}-(?:[a-f\\d]{4}-){3}[a-f\\d]{12}',scopePattern=new RegExp(`^${uuid}:${uuid}$`,'i'),idPattern=new RegExp(`^${uuid}$`,'i');
export const desktopNotificationOptions=Object.freeze({title:'GAON ERP 업무 알림',body:'새 업무 메시지가 도착했습니다. 앱에서 확인해 주세요.',silent:false});
export async function prepareWindowsNotificationShortcut({platform=process.platform,app,shell,exists=async file=>access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})}){
 if(platform!=='win32')return;const id='studio.keelson.gaon.erp',file=path.win32.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','GAON ERP.lnk'),target=app.getPath('exe');
 if(await exists(file)){const current=shell.readShortcutLink(file);if(current.appUserModelId!==id&&path.win32.normalize(current.target).toLowerCase()!==path.win32.normalize(target).toLowerCase())throw Error('기존 GAON ERP 시작 메뉴 바로가기를 확인해 주세요.');}
 if(!shell.writeShortcutLink(file,'create',{target,cwd:path.win32.dirname(target),appUserModelId:id,description:'GAON ERP 업무 공간'}))throw Error('시작 메뉴에 앱 알림 연결을 준비하지 못했습니다.');
}
export function createNativeNotifier(Notification){return(options,handlers)=>{const notice=new Notification(options);for(const event of ['click','show','close','failed'])notice.on(event,()=>handlers[event]?.());return notice;};}
export function createNotificationPreferenceStore(file){
 let tail=Promise.resolve();
 return {async read(){try{const value=JSON.parse(await readFile(file,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}},write(value){const task=tail.catch(()=>{}).then(async()=>{const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(value)+'\n',{mode:0o600});await rename(temporary,file);});tail=task;return task;}};
}
export function desktopNotificationSender(event,window,isInternal){return !!window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&isInternal(event.senderFrame?.url)===true;}
export function installDesktopNotificationIPC(ipcMain,{controller,getWindow,isInternal}){
 const names=['gaon-notifications:status','gaon-notifications:configure'];
 const checked=event=>{if(!desktopNotificationSender(event,getWindow(),isInternal))throw Error('허용되지 않은 화면입니다.');};
 ipcMain.handle(names[0],async event=>{checked(event);await controller.refresh();return controller.status();});
 ipcMain.handle(names[1],async(event,value)=>{checked(event);return controller.configure(value);});
 return()=>names.forEach(name=>ipcMain.removeHandler(name));
}
export function observeDesktopLogout(ses,{getOrigin,controller}){
 // This observer never reads response headers, cookies, or token values.
 ses.webRequest.onCompleted({urls:['http://127.0.0.1:4180/api/gaon/auth/logout','https://*/api/gaon/auth/logout']},details=>{
  try{const u=new URL(details.url);if(u.origin===getOrigin()&&u.pathname==='/api/gaon/auth/logout'&&details.method==='POST'&&details.statusCode>=200&&details.statusCode<300)controller.signedOut();}catch{}
 });
}
export function createDesktopNotifications({fetcher,getOrigin,isInternal,createNotification,supported=()=>true,preferences={read:async()=>({}),write:async()=>{}},onUnauthorized=()=>{},onOpen=()=>{},prepare=async()=>{},setTimer=setTimeout,clearTimer=clearTimeout,interval=30000}={}){
 let scope='',cursor='',enabled=false,mode='mentions',connected=false,active=true,generation=0,working=null,timer=null,failures=0,notice=null,message='',delivered=0,configuring=false;
 let prefs=null;const seen=new Set(),requests=new Set();
 const status=()=>({supported:!!supported(),authenticated:!!scope,enabled,mode,connected,running:active,delivered,message});
 const closeNotice=()=>{const old=notice;notice=null;try{old?.close();}catch{}};
 function cancel(clearScope){generation++;if(timer)clearTimer(timer);timer=null;for(const req of requests)req.abort();requests.clear();working=null;cursor='';seen.clear();closeNotice();if(clearScope){scope='';enabled=false;mode='mentions';connected=false;delivered=0;message='직원 로그인 후 이 기기의 알림을 켤 수 있어요.';}}
 const origin=()=>{const value=getOrigin();try{const u=new URL(value);return !u.username&&!u.password&&u.origin===value&&(u.protocol==='https:'||value==='http://127.0.0.1:4180')&&isInternal(value+'/erp/home.html#today')?value:'';}catch{return '';}};
 async function request(path,epoch){
  const base=origin();if(!base)throw Error('connection');const abort=new AbortController();requests.add(abort);const timeout=setTimer(()=>abort.abort(),12000);
  try{const response=await fetcher(base+path,{headers:{Accept:'application/json'},cache:'no-store',credentials:'include',redirect:'error',signal:abort.signal});if(epoch!==generation||base!==origin())return null;if([401,403].includes(response.status)){cancel(true);onUnauthorized();return null;}if(!response.ok){const error=Error('connection');error.status=response.status;throw error;}const text=await response.text();if(text.length>65536)throw Error('response');const value=JSON.parse(text);return epoch===generation?value:null;}
  finally{clearTimer(timeout);requests.delete(abort);}
 }
 function schedule(quick=false){if(!active||!enabled)return;if(timer)clearTimer(timer);timer=setTimer(()=>{timer=null;refresh();},quick?1000:Math.min(300000,interval*2**Math.min(failures,4)));timer.unref?.();}
 const prefKey=()=>createHash('sha256').update(origin()+'|'+scope).digest('hex');
 async function openItem(item,expectedScope,epoch){
  if(!active||!enabled||epoch!==generation||scope!==expectedScope)return;
  try{const result=await request('/api/gaon/push?messageId='+item.messageId,epoch);if(!result||epoch!==generation||scope!==expectedScope||!result.canOpen||result.identityId!==expectedScope.split(':')[1]||result.roomId!==item.roomId)return;
   const url=origin()+'/erp/home.html#erp/talk/'+item.roomId+'/'+item.messageId;if(!isInternal(url))return;await onOpen(url);closeNotice();
  }catch{if(epoch===generation)message='알림의 업무 권한을 다시 확인해 주세요.';}
 }
 async function refresh(){
  if(!active)return status();if(working)return working;
  const epoch=generation;let more=false,operation;
  operation=(async()=>{try{
   const requestedMode=mode,query=new URLSearchParams({mode});if(cursor&&enabled)query.set('cursor',cursor);
   const result=await request('/api/gaon/push/inbox?'+query,epoch);if(!result||epoch!==generation)return status();
   if(!scopePattern.test(result.identityScope)||typeof result.cursor!=='string'||!result.cursor||result.cursor.length>4096||!Array.isArray(result.items)||result.items.length>100||result.items.some(item=>!idPattern.test(item?.messageId)||!idPattern.test(item?.roomId)))throw Error('response');
   failures=0;connected=true;
   if(scope!==result.identityScope){closeNotice();seen.clear();scope=result.identityScope;cursor=result.cursor;delivered=0;prefs??=await preferences.read();if(epoch!==generation)return status();const value=prefs[prefKey()];enabled=value?.enabled===true&&!!supported();mode=value?.mode==='all'?'all':'mentions';if(mode!==requestedMode){cursor='';more=true;}message=enabled?'앱 실행 중 업무 알림을 받습니다.':'이 기기의 업무 알림이 꺼져 있어요.';return status();}
   cursor=result.cursor;more=result.hasMore===true;
   if(!enabled)return status();
   const fresh=result.items.filter(item=>!seen.has(item.messageId));for(const item of fresh)seen.add(item.messageId);while(seen.size>500)seen.delete(seen.values().next().value);
   if(fresh.length){const item=fresh.at(-1),expectedScope=scope;closeNotice();const current=createNotification(desktopNotificationOptions,{click:()=>openItem(item,expectedScope,epoch),show:()=>{if(epoch===generation){delivered++;message='이 기기로 업무 알림이 전달됐어요.';}},failed:()=>{if(epoch===generation)message='운영체제의 GAON ERP 알림 허용을 확인해 주세요.';},close:()=>{if(notice===current)notice=null;}});notice=current;current.show();}
   return status();
  }catch(error){if(epoch===generation){connected=false;failures++;if(error.status===400)cursor='';message='알림 연결을 다시 확인하고 있어요. 잠시 후 재시도합니다.';}return status();}
  finally{if(working===operation){working=null;if(epoch===generation)schedule(more);}}})();working=operation;return operation;
 }
 async function configure(value){
  if(!value||typeof value.enabled!=='boolean'||!['mentions','all'].includes(value.mode)||Object.keys(value).some(k=>!['enabled','mode'].includes(k)))throw Error('알림 설정을 확인해 주세요.');
  if(configuring)throw Error('알림 설정 저장 중입니다.');configuring=true;
  try{if(!scope)await refresh();if(!scope)throw Error('직원 로그인 후 알림을 설정해 주세요.');if(value.enabled&&!supported())throw Error('현재 운영체제에서 앱 알림을 사용할 수 없습니다.');
   const expectedScope=scope,epoch=generation;if(value.enabled)await prepare();if(epoch!==generation||scope!==expectedScope)throw Error('로그인 계정이 변경됐습니다. 다시 설정해 주세요.');prefs??=await preferences.read();const updated={...prefs,[prefKey()]:{enabled:value.enabled,mode:value.mode}};
   // Limit old, non-sensitive preferences; no session, key, message or financial data is persisted.
   for(const key of Object.keys(updated).slice(0,Math.max(0,Object.keys(updated).length-100)))delete updated[key];
   await preferences.write(updated);if(epoch!==generation||scope!==expectedScope)throw Error('로그인 계정이 변경됐습니다. 다시 설정해 주세요.');prefs=updated;cancel(false);enabled=value.enabled;mode=value.mode;message=enabled?'앱 실행 중 업무 알림을 받습니다.':'이 기기의 업무 알림이 꺼져 있어요.';
   if(enabled)await refresh();return status();
  }finally{configuring=false;}
 }
 return {status,refresh,configure,signedOut(){cancel(true);},reset(){cancel(true);},resume(){active=true;return refresh();},stop(){active=false;cancel(true);}};
}
