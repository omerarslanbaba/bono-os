import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {nextSevenDays,calendarDate} from '../web/js/calendar-window.mjs';
const require=createRequire(import.meta.url);
const {JSDOM}=require('../dist/ui-test-env/node_modules/jsdom');
const now=new Date('2030-01-01T12:00:00Z');
const rows=[{id:1,starts_at:'2030-01-01T00:01:00+03:00'},
 {id:2,starts_at:'2030-01-07T23:59:00+03:00'},
 {id:3,starts_at:'2030-01-08T00:00:00+03:00'},
 {id:4,starts_at:'2029-12-31T20:59:00Z'},{id:5,starts_at:'invalid'}];
assert.deepEqual(nextSevenDays(rows,'starts_at',now).map(x=>x.id),[1,2]);
assert.equal(calendarDate('2029-12-31T21:01:00Z'),'2030-01-01');
assert.equal(nextSevenDays([{due_at:'2030-01-07'},{due_at:'2030-01-08'}],'due_at',now).length,1);
console.log('PASS Turkey seven calendar days: earlier today included; day eight, yesterday and invalid excluded');
const dom=new JSDOM('<div id="app"></div>');
const source=fs.readFileSync('web/js/views/active/today.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
const ctx=vm.createContext({document:dom.window.document,Date,api:{upcomingHearings:async()=>[],deadlines:async()=>[],uyapCases:async()=>[]},inventoryTotals:()=>({known:0,never:0,partial:0,unknown:0}),notificationContract:{message:''},nextSevenDays,esc:x=>x,empty:x=>x,pageHero:()=>'',section:(title,icon,body)=>'<section>'+title+body+'</section>',mount:html=>dom.window.document.getElementById('app').innerHTML=html});
vm.runInContext(source,ctx);await ctx.renderToday();
assert.match(dom.window.document.body.textContent,/7 Gün İçindeki Duruşmalar/);
assert.match(dom.window.document.body.textContent,/7 Gün İçindeki Süreler/);
for(const label of ['Günlük Özet','Yaklaşan Duruşmalar','Bugünkü duruşma','Bugünkü açık iş'])assert(!dom.window.document.body.textContent.includes(label));
const hearings=fs.readFileSync('web/js/views/active/hearings.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
vm.runInContext(hearings,vm.createContext({Date,esc:x=>x}));
const calendarCtx=vm.createContext({Date,esc:x=>x});vm.runInContext(hearings,calendarCtx);
const html=vm.runInContext('calendar([])',calendarCtx);
assert(!html.includes('thisPeriod'));assert(!html.includes('← Önceki'));assert(!html.includes('Sonraki →'));
assert.match(html,/aria-label="Önceki dönem"/);
console.log('PASS Today sections and accessible arrow calendar controls');
