import {renderToday} from './views/active/today.js';
import {renderUyap} from './views/active/uyap.js';
import {renderHearings} from './views/active/hearings.js';
import {renderPowers} from './views/active/powers.js';
import {renderSystem} from './views/active/system.js';
import {renderAccounting} from './views/active/accounting.js';
import {mount,pageHero,section,empty} from './ui.js';

async function router(){
 const raw=(location.hash||'#today').slice(1),parts=raw.split('/').filter(Boolean),key=parts[0]||'today',id=parts[1];
 try{
  if(key==='today')return await renderToday();
  if(key==='uyap')return await renderUyap(id);
  if(key==='hearings')return await renderHearings(id);
  if(key==='powers')return await renderPowers(id);
  if(key==='accounting')return await renderAccounting();
  if(key==='system')return await renderSystem();
  location.hash='#today';
 }catch(e){
  console.error(e);
  mount(pageHero('Bir hata oluştu',e.message)+section('Teknik Bilgi','!',empty(String(e.message||e))),'system');
 }
}
window.addEventListener('hashchange',router);
window.addEventListener('DOMContentLoaded',router);
document.addEventListener('click',e=>{
  const a=e.target.closest?.('a[href^="#"]');
  if(!a)return;
  const href=a.getAttribute('href');
  if(!href||href==='#')return;
  e.preventDefault();
  if(location.hash===href) router();
  else location.hash=href;
});
