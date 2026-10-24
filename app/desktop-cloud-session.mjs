import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
export const desktopCloudOrigin='https://gaon-erp-keelson.web.app';
export const desktopCloudAPI='https://xclpqltmkylbavfzitfa.supabase.co/functions/v1/gaon-api';
export const desktopOAuthCallback='studio.keelson.gaon://auth/callback';
const fail=(message,status=503,code='UNAVAILABLE')=>{throw Object.assign(Error(message),{status,code});};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function desktopCallbackCode(raw){
 let url;try{url=new URL(raw);}catch{fail('로그인 복귀 주소를 확인할 수 없습니다.',400);}
 if(url.protocol!=='studio.keelson.gaon:'||url.hostname!=='auth'||url.pathname!=='/callback'||url.port||url.username||url.password||url.hash)fail('허용되지 않은 로그인 복귀 주소입니다.',400);
 if([...url.searchParams.keys()].some(key=>!['code','error','error_code','error_description'].includes(key)))fail('로그인 연결을 다시 시작해 주세요.',400);
 if(['error','error_code','error_description'].some(key=>url.searchParams.has(key)))fail('Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.',400,'LOGIN_CANCELLED');
 const codes=url.searchParams.getAll('code');if(codes.length!==1||!codes[0]||codes[0].length>4096||/[\x00-\x20\x7f]/.test(codes[0]))fail('로그인 연결을 다시 시작해 주세요.',400);return codes[0];
}
export function desktopCloudPath(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\#]/.test(value)||!value.startsWith('/api/gaon/')||value.includes('..'))fail('허용되지 않은 업무 요청입니다.',400,'INPUT');
 const url=new URL(value,desktopCloudOrigin);if(url.origin!==desktopCloudOrigin||!/^\/api\/gaon\/[a-z0-9][a-z0-9/_-]*$/.test(url.pathname))fail('허용되지 않은 업무 요청입니다.',400,'INPUT');
 if(url.pathname.startsWith('/api/gaon/auth/')&&!['/api/gaon/auth/status','/api/gaon/auth/logout'].includes(url.pathname))fail('로그인 인증정보는 업무 화면에서 요청할 수 없습니다.',403,'FORBIDDEN');return url.pathname+url.search;
}
export function createDesktopCredentialStore({file,safeStorage,fs={readFile,writeFile,rename,rm}}){
 const available=async()=>{if(!safeStorage||(!await safeStorage.isAsyncEncryptionAvailable?.()||safeStorage.getSelectedStorageBackend?.()==='basic_text'))fail('이 Windows 계정의 로그인 보안 저장소를 사용할 수 없습니다.');};
 return {
  async read(){let bytes;try{bytes=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;fail('저장한 로그인 정보를 확인하지 못했습니다.');}if(bytes.length>32768)fail('저장한 로그인 정보를 확인하지 못했습니다.');await available();try{const decrypted=await safeStorage.decryptStringAsync(bytes),value=decrypted?.result;if(typeof value!=='string'||!value||value.length>4096)throw Error();return value;}catch{fail('이 기기에서 로그인 정보를 복원하지 못했습니다. 다시 로그인해 주세요.',401,'AUTH_REQUIRED');}},
  async write(value){if(typeof value!=='string'||!value||value.length>4096)fail('로그인 정보를 저장하지 못했습니다.');await available();const bytes=await safeStorage.encryptStringAsync(value),temporary=file+'.tmp';try{await fs.writeFile(temporary,bytes,{mode:0o600});await fs.rename(temporary,file);}catch{await fs.rm(temporary,{force:true}).catch(()=>{});fail('로그인 정보를 안전하게 저장하지 못했습니다.');}},
  async remove(){await fs.rm(file,{force:true});}
 };
}
export function createDesktopCloudSession({store,fetcher=fetch,now=Date.now,onUnauthorized=()=>{},random=()=>randomBytes(32).toString('base64url')}={}){
 if(!store||!['read','write','remove'].every(k=>typeof store[k]==='function'))throw Error('Protected credential store required');
 let current=null,refreshing=null,pending=null,generation=0;
 const raw=async(path,options={})=>{try{return await fetcher(desktopCloudAPI+path,{...options,headers:{Origin:desktopCloudOrigin,...options.headers},credentials:'omit',redirect:'error',cache:'no-store',signal:options.signal||AbortSignal.timeout(25000)});}catch{fail('업무 서버 연결이 지연되고 있습니다. 입력한 내용은 유지됩니다.');}};
 async function clear(){generation++;current=null;pending=null;await store.remove();onUnauthorized();}
 async function authPost(action,body){const response=await raw('/api/gaon/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok){if(response.status===401||response.status===403){await clear();fail('등록된 직원 계정으로 다시 로그인해 주세요.',401,'AUTH_REQUIRED');}fail('로그인 서버 연결이 지연되고 있습니다. 다시 시도해 주세요.');}let value;try{value=await response.json();}catch{fail('로그인 서버 응답을 확인하지 못했습니다.');}if(typeof value?.accessToken!=='string'||!value.accessToken||typeof value.refreshToken!=='string'||!value.refreshToken||!Number.isFinite(value.expiresAt)||value.expiresAt<=now())fail('로그인 서버 응답을 확인하지 못했습니다.');return value;}
 async function identity(session){const response=await raw('/api/gaon/auth/status',{headers:{Authorization:'Bearer '+session.accessToken}});if(response.status===401||response.status===403){await clear();fail('직원 등록과 접근 권한을 확인해 주세요.',401,'AUTH_REQUIRED');}if(!response.ok)fail('직원 권한 확인이 지연되고 있습니다.');const status=await response.json();if(status?.signedIn!==true||!status.actor?.id||!['admin','lead','staff'].includes(status.role))fail('직원 권한을 확인하지 못했습니다.',403,'AUTH_REQUIRED');return status;}
 async function ensure(){
  if(current?.expiresAt>now()+30000)return current;
  if(!refreshing){const epoch=generation;refreshing=(async()=>{const token=current?.refreshToken||await store.read();if(!token)return null;const session=await authPost('refresh',{refreshToken:token});if(epoch!==generation)fail('로그인 계정이 변경됐습니다.',401,'AUTH_REQUIRED');await store.write(session.refreshToken);if(epoch!==generation){await store.remove();fail('로그인 계정이 변경됐습니다.',401,'AUTH_REQUIRED');}current=session;return current;})().finally(()=>{refreshing=null;});}return refreshing;
 }
 async function request(input){
  const path=desktopCloudPath(input?.path),method=String(input?.method||'GET').toUpperCase();if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method))fail('허용되지 않은 업무 요청입니다.',405,'INPUT');
  const headers={};for(const [key,value] of Object.entries(input?.headers||{})){if(!['content-type','if-none-match','cache-control','x-gaon-upload-consent','accept'].includes(key.toLowerCase())||typeof value!=='string'||value.length>500||/[\r\n]/.test(value))fail('허용되지 않은 요청 헤더입니다.',400,'INPUT');headers[key.toLowerCase()]=value;}
  let body=input?.body??undefined;if(body!==undefined&&typeof body!=='string'){if(!(body instanceof ArrayBuffer)&&!ArrayBuffer.isView(body))fail('업무 요청을 확인해 주세요.',400,'INPUT');body=Buffer.from(body instanceof ArrayBuffer?new Uint8Array(body):body);}
  if(body!==undefined&&(Buffer.byteLength(body)>21*1024*1024||['GET','HEAD'].includes(method)))fail('업무 요청 크기를 확인해 주세요.',413,'INPUT');
  const session=await ensure();if(!session)return json(path==='/api/gaon/auth/status'?200:401,path==='/api/gaon/auth/status'?{signedIn:false,googleEnabled:true}:{error:'직원 로그인이 필요합니다.'});
  headers.Authorization='Bearer '+session.accessToken;const response=await raw(path,{method,headers,body});
  if(response.status===401){await clear();return response;}
  if(response.status===403){const problem=await response.clone().json().catch(()=>null);if(problem?.code==='STAFF_ACCESS_DENIED'||path==='/api/gaon/auth/status'){await clear();return json(401,{error:'직원 접근 권한을 다시 확인해 주세요.'});}}
  if(path==='/api/gaon/auth/logout'&&response.ok)await clear();return response;
 }
 return Object.freeze({
  request,
  async health(){const response=await raw('/api/gaon/auth/status');if(!response.ok)fail('GAON 서버 연결을 확인하지 못했습니다.');const status=await response.json();if(status.signedIn!==false||status.googleEnabled!==true)fail('GAON 서버 응답을 확인하지 못했습니다.');return true;},
  async status(){const session=await ensure();return session?identity(session):{signedIn:false,googleEnabled:true};},
  async begin(){await clear();const verifier=random();if(!/^[-_A-Za-z0-9]{43,128}$/.test(verifier))fail('로그인을 시작하지 못했습니다.');pending={verifier,createdAt:now()};const url=new URL('https://xclpqltmkylbavfzitfa.supabase.co/auth/v1/authorize');url.search=new URLSearchParams({provider:'google',redirect_to:desktopOAuthCallback,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256'});return url.href;},
  async complete(rawURL){const code=desktopCallbackCode(rawURL),flow=pending;if(!flow||now()-flow.createdAt>300000){pending=null;fail('로그인 연결이 만료됐습니다. 다시 시도해 주세요.',401,'AUTH_REQUIRED');}pending=null;const epoch=generation,session=await authPost('exchange',{code,verifier:flow.verifier});const status=await identity(session);if(epoch!==generation)fail('로그인 계정이 변경됐습니다.',401,'AUTH_REQUIRED');await store.write(session.refreshToken);if(epoch!==generation){await store.remove();fail('로그인 계정이 변경됐습니다.',401,'AUTH_REQUIRED');}current=session;return status;},
  cancel(){pending=null;},clear
 });
}
export async function desktopCloudReply(response){
 const limit=48*1024*1024,declared=Number(response.headers.get('content-length'));if(declared>limit){await response.body?.cancel();fail('자료가 너무 큽니다. 조회 범위를 좁혀 주세요.',413,'INPUT');}
 const chunks=[];let total=0;const reader=response.body?.getReader();if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();fail('자료가 너무 큽니다. 조회 범위를 좁혀 주세요.',413,'INPUT');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const headers={};for(const name of ['content-type','content-disposition','cache-control','etag'])if(response.headers.has(name))headers[name]=response.headers.get(name);
 return {status:response.status,headers,body:bytes};
}
