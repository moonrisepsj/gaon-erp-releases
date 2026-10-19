const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('gaonDesktop',Object.freeze({
 state:()=>ipcRenderer.invoke('gaon-client:state'),
 saveServer:server=>ipcRenderer.invoke('gaon-client:save-server',server),
 login:()=>ipcRenderer.invoke('gaon-client:login'),
 openApp:()=>ipcRenderer.invoke('gaon-client:open-app'),
 forgetServer:()=>ipcRenderer.invoke('gaon-client:forget-server'),
 openManual:()=>ipcRenderer.invoke('gaon-client:manual')
}));
