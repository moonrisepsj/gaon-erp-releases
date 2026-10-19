import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeServerURL,clientURLAction,trustedClientHealth,trustedClientStatus,trustedClientDownload,clientWebPreferences} from '../desktop-client-policy.mjs';

const origin='https://erp.example.com';
test('server setup accepts only a bare public HTTPS origin',()=>{
 assert.equal(normalizeServerURL('  https://erp.example.com/  '),origin);
 for(const value of ['http://erp.example.com','https://user:pass@erp.example.com','https://erp.example.com:444','https://erp.example.com/erp/','https://erp.example.com/?next=x','https://localhost','https://studio.local','not a URL'])assert.throws(()=>normalizeServerURL(value));
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
