export const clientWebPreferences={
 nodeIntegration:false,
 contextIsolation:true,
 sandbox:true,
 webSecurity:true,
 allowRunningInsecureContent:false,
 webviewTag:false
};

export function normalizeServerURL(raw){
 if(typeof raw!=='string')throw Error('서버 주소를 입력해 주세요.');
 let url;
 try{url=new URL(raw.trim());}catch{throw Error('https://로 시작하는 서버 주소를 입력해 주세요.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('경로 없이 https:// 서버 주소만 입력해 주세요.');
 if(!url.hostname.includes('.')||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw Error('관리자가 안내한 HTTPS 서버 주소를 입력해 주세요.');
 return url.origin;
}

export function clientURLAction(raw,serverOrigin){
 try{
  const url=new URL(raw);
  if(url.username||url.password)return 'deny';
  if(serverOrigin&&url.origin===serverOrigin){
   if(url.pathname==='/api/gaon/auth/login')return 'login';
   if(url.pathname==='/api/gaon/drive/connect')return 'drive';
   if(url.pathname.startsWith('/erp/'))return 'internal';
   return 'deny';
  }
  return url.protocol==='https:'?'external':'deny';
 }catch{return 'deny';}
}

export function trustedClientHealth(value){
 return value?.status==='ok'&&value?.service==='gaon-erp'&&value?.desktopProtocol===1;
}

export function trustedClientStatus(value){
 return value?.signedIn===true&&typeof value.role==='string'&&value.role.length>0;
}

export function trustedClientDownload(raw,serverOrigin){
 try{const url=new URL(raw);return !url.username&&!url.password&&((url.protocol==='blob:'&&url.origin===serverOrigin)||(url.protocol==='https:'&&url.origin===serverOrigin));}catch{return false;}
}
