const $=id=>document.getElementById(id);
const form=$('server-form'),input=$('server'),login=$('login'),openApp=$('open-app'),forget=$('forget'),status=$('status');
let busy=false,verifiedOrigin='',verifiedSession=false;
function message(text,error=false){status.textContent=text||'';status.classList.toggle('error',error);}
function sameAddress(){return !!verifiedOrigin&&input.value.trim().replace(/\/$/,'')===verifiedOrigin;}
function lock(value){busy=value;input.disabled=value;form.querySelector('button').disabled=value;forget.disabled=value;login.disabled=value||!sameAddress();openApp.disabled=value||!sameAddress()||!verifiedSession;}
function setState(state){verifiedOrigin=state.connected?state.serverOrigin:'';verifiedSession=state.signedIn===true;input.value=state.serverOrigin||'';const details=$('connection-details');if(details)details.open=!!state.serverOrigin&&state.serverOrigin!=='https://gaon-erp-keelson.web.app';forget.hidden=!state.serverOrigin;openApp.hidden=!verifiedSession;lock(busy);}
async function refresh(){const state=await window.gaonDesktop.state();setState(state);if(state.message)message(state.message,!state.connected&&!!state.serverOrigin);}
form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;lock(true);message('서버의 안전한 연결을 확인하고 있습니다…');try{const state=await window.gaonDesktop.saveServer(input.value);setState(state);message(state.message);}catch(error){verifiedOrigin='';verifiedSession=false;openApp.hidden=true;message(error.message,true);}finally{lock(false);}});
login.addEventListener('click',async()=>{if(busy||!sameAddress())return;lock(true);message('기본 브라우저에서 직원 로그인을 완료해 주세요…');try{const result=await window.gaonDesktop.login();message(result.message);}catch(error){message(error.message,true);}finally{lock(false);}});
openApp.addEventListener('click',async()=>{if(busy||!sameAddress())return;try{await window.gaonDesktop.openApp();}catch(error){message(error.message,true);}});
forget.addEventListener('click',async()=>{if(busy)return;lock(true);try{await window.gaonDesktop.forgetServer();verifiedOrigin='';verifiedSession=false;input.value='';forget.hidden=true;openApp.hidden=true;message('저장한 서버 주소를 지웠습니다.');}catch(error){message(error.message,true);}finally{lock(false);}});
$('manual').addEventListener('click',()=>window.gaonDesktop.openManual().catch(error=>message(error.message,true)));
input.addEventListener('input',()=>lock(busy));
refresh().catch(()=>message('앱 연결 정보를 읽지 못했습니다.',true));
