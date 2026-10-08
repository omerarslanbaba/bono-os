// Source of truth: observed CBS/party search contract in feature/uyap-core.
// This UI never initiates document.list, file download, or manual-pause changes.
const provincesByPlate="Adana|Adıyaman|Afyonkarahisar|Ağrı|Amasya|Ankara|Antalya|Artvin|Aydın|Balıkesir|Bilecik|Bingöl|Bitlis|Bolu|Burdur|Bursa|Çanakkale|Çankırı|Çorum|Denizli|Diyarbakır|Edirne|Elazığ|Erzincan|Erzurum|Eskişehir|Gaziantep|Giresun|Gümüşhane|Hakkâri|Hatay|Isparta|Mersin|İstanbul|İzmir|Kars|Kastamonu|Kayseri|Kırklareli|Kırşehir|Kocaeli|Konya|Kütahya|Malatya|Manisa|Kahramanmaraş|Mardin|Muğla|Muş|Nevşehir|Niğde|Ordu|Rize|Sakarya|Samsun|Siirt|Sinop|Sivas|Tekirdağ|Tokat|Trabzon|Tunceli|Şanlıurfa|Uşak|Van|Yozgat|Zonguldak|Aksaray|Bayburt|Karaman|Kırıkkale|Batman|Şırnak|Bartın|Ardahan|Iğdır|Yalova|Karabük|Kilis|Osmaniye|Düzce".split("|");
const normalizeCourt=s=>String(s||"").normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/[.,;:_\s-]+/g," ").trim();
function createCaseLink(item,label){
  const id=Number(item.caseId??item.id);
  if(!Number.isSafeInteger(id)||id<1)return null;
  const a=document.createElement("a");
  a.className="case-handoff-link";
  a.href="#uyap/"+id;
  a.textContent=label||String(item.court||"Cumhuriyet Başsavcılığı")+" · "+String(item.fileNo||item.court_file_no||"Soruşturma")+" → Dosyayı Aç";
  return a;
}
function formField(label,tag,id,options){
  const wrap=document.createElement("label");
  wrap.textContent=label;
  const element=document.createElement(tag);
  element.id=id;
  if(options?.type)element.type=options.type;
  if(options?.placeholder)element.placeholder=options.placeholder;
  if(options?.autocomplete)element.autocomplete=options.autocomplete;
  wrap.appendChild(element);
  return {wrap,element};
}
function panel(title,subtitle,badge){
  const root=document.createElement("section");
  root.className="case-cbs-handoff-panel";
  const top=document.createElement("div");top.className="case-cbs-handoff-head";
  const copy=document.createElement("div");
  const h=document.createElement("strong");h.textContent=title;copy.appendChild(h);
  const p=document.createElement("p");p.textContent=subtitle;copy.appendChild(p);top.appendChild(copy);
  const tag=document.createElement("span");tag.textContent=badge;tag.className="case-targeted-tag";top.appendChild(tag);root.appendChild(top);
  const grid=document.createElement("div");grid.className="case-query-grid";root.appendChild(grid);
  const actions=document.createElement("div");actions.className="case-targeted-actions";root.appendChild(actions);
  const status=document.createElement("small");status.setAttribute("role","status");status.setAttribute("aria-live","polite");actions.appendChild(status);
  const results=document.createElement("div");results.className="case-cbs-handoff-results";results.hidden=true;root.appendChild(results);
  return {root,grid,actions,status,results};
}
function addResult(container,title,items){
  container.replaceChildren();
  const strong=document.createElement("strong");strong.textContent=title;container.appendChild(strong);
  for(const item of items){const link=createCaseLink(item);if(link)container.appendChild(link)}
  container.hidden=false;
}
// A read-only, opt-in watcher covers jobs started by a separate UYAP session or Chat-UYAP.
function bindIncomingWatcher(api,host){
  const ui=panel("BONO'ya Gelen Dosyayı Aç","UYAP sorgusu başka yerden başlatılmışsa, bulunan dosyayı BONO case kaydından aç.","Salt-okunur takip");
  const court=formField("Mahkeme / Başsavcılık","input","incomingCourt",{placeholder:"Örn. Eskişehir Cumhuriyet Başsavcılığı"});
  const no=formField("Dosya Numarası","input","incomingFileNo",{placeholder:"Örn. 2026/51832"});
  ui.grid.append(court.wrap,no.wrap);host.appendChild(ui.root);
  const button=document.createElement("button");button.className="subtle-action";button.type="button";button.textContent="Dosya Kaydını İzle";ui.actions.appendChild(button);
  ui.status.textContent="Bu kontrol yeni UYAP sorgusu başlatmaz, yalnız BONO dosya kayıtlarını okur.";
  const note=document.createElement("p");note.className="case-targeted-notice";note.textContent="Birim ve numara eşleşmesi taraf kimliğini tek başına doğrulamaz. Dosyayı açınca taraf ve evrak bilgilerini kontrol et.";ui.root.appendChild(note);
  let timer=null,running=false;
  const alive=()=>ui.root.isConnected&&location.hash==="#uyap";
  const stop=()=>{running=false;if(timer)clearTimeout(timer);timer=null;button.textContent="Dosya Kaydını İzle"};
  async function check(){
    if(!running||!alive()){stop();return}
    try{
      const rows=await api.uyapCases();
      if(!running||!alive())return;
      const results=rows.filter(r=>
        normalizeCourt(r.court)===normalizeCourt(court.element.value)&&
        String(r.court_file_no||"").replace(/\s+/g,"")===no.element.value.replace(/\s+/g,"")
      );
      if(results.length===1){
        const link=createCaseLink(results[0],String(results[0].court)+" · "+String(results[0].court_file_no)+" → Dosyayı Aç ve Evrakları Sorgula");
        if(link){stop();ui.results.replaceChildren();const title=document.createElement("strong");title.textContent="Dosya BONO'ya geldi";ui.results.append(title,link);ui.results.hidden=false;ui.status.textContent="Dosya bulundu. Kimlik eşleşmesini dosya detayından kontrol et.";return}
      }
      ui.status.textContent=results.length>1?"Birden çok kayıt eşleşti; otomatik seçim yapılmadı.":"Dosya henüz BONO'ya gelmedi. Her 5 saniyede tekrar kontrol ediliyor.";
      timer=setTimeout(check,5000);
    }catch(e){if(running&&alive()){ui.status.textContent="Dosya kayıtları okunamadı: "+e.message;timer=setTimeout(check,10000)}}
  }
  button.onclick=()=>{
    if(running){stop();ui.status.textContent="Dosya takibi durduruldu.";return}
    if(!court.element.value.trim()||!/^\d{4}\/\d+$/.test(no.element.value.trim())){
      ui.status.textContent="Tam başsavcılık adı ve YYYY/NO biçiminde dosya numarası gerekli.";return;
    }
    running=true;ui.results.hidden=true;ui.results.replaceChildren();
    button.textContent="İzlemeyi Durdur";check();
  };
}
function bindCbsPartySearch(api,host,schema){
  const ui=panel("CBS Soruşturma Dosyası Bul","Dosya numarası bilinmiyorsa doğrulanmış UYAP CBS biriminde tam taraf adı ve tarih aralığıyla sorgula.","En fazla 25 aday");
  const province=formField("İl","select","cbsPartyProvince");
  const first=document.createElement("option");first.value="";first.textContent="İl seçin";province.element.appendChild(first);
  provincesByPlate.forEach((n,i)=>{const o=document.createElement("option");o.value=String(i+1);o.textContent=n;province.element.appendChild(o)});
  const unit=formField("Cumhuriyet Başsavcılığı","select","cbsPartyUnit");
  const name=formField("Taraf Adı Soyadı","input","cbsPartyName",{placeholder:"UYAP'taki tam ad soyad",autocomplete:"off"});
  const status=formField("Dosya Durumu","select","cbsPartyStatus");
  [["both","Açık ve Kapalı"],["open","Açık"],["closed","Kapalı"]].forEach(([value,label])=>{const o=document.createElement("option");o.value=value;o.textContent=label;status.element.appendChild(o)});
  const from=formField("Açılış Başlangıç Tarihi","input","cbsPartyFrom",{type:"date"});
  const to=formField("Açılış Bitiş Tarihi","input","cbsPartyTo",{type:"date"});
  ui.grid.append(province.wrap,unit.wrap,name.wrap,status.wrap,from.wrap,to.wrap);
  host.appendChild(ui.root);
  const button=document.createElement("button");button.className="primary-action";button.type="button";button.textContent="⌕ CBS Dosyası Bul";ui.actions.appendChild(button);
  const note=document.createElement("p");note.className="case-targeted-notice";
  note.textContent="Yalnız 1–120 günlük açılış aralığındaki adayların taraf bilgileri sorgulanır. Tam ad eşleşmesi dışında hiçbir kayıt BONO'ya alınmaz; PDF/UDF indirme başlatılmaz. Taraf adı tarayıcıda saklanmaz.";
  ui.root.appendChild(note);
  const supported=schema?.contractVersion==="uyap.cbs-party-search-schema.v1"&&schema.ready===true;
  province.element.disabled=!supported;
  unit.element.disabled=true;button.disabled=true;
  ui.status.textContent=supported?"İl ve başsavcılık seçin. Arama yalnız butona tıklanınca başlar.":"CBS taraf sorgulama servisi henüz mevcut Core sürümünde kullanılamıyor.";
  let revision=0,pollTimer=null,busy=false;
  const alive=()=>ui.root.isConnected&&location.hash==="#uyap";
  function clearPoll(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null}
  function release(){busy=false;button.disabled=!unit.element.value;province.element.disabled=false;unit.element.disabled=!unit.element.options.length}
  province.element.onchange=async()=>{
    const current=++revision;clearPoll();busy=false;button.disabled=true;unit.element.disabled=true;
    unit.element.replaceChildren();ui.results.hidden=true;ui.results.replaceChildren();
    if(!province.element.value){ui.status.textContent="İl seçin.";return}
    ui.status.textContent="Gözlemlenmiş CBS birimleri alınıyor…";
    try{
      const x=await api.uyapCbsUnits(Number(province.element.value));
      if(!alive()||current!==revision)return;
      if(x.contractVersion!=="uyap.cbs-units.v1"||Number(x.ilKodu)!==Number(province.element.value))throw new Error("CBS birim sözleşmesi doğrulanamadı");
      const choose=document.createElement("option");choose.value="";choose.textContent="Başsavcılık seçin";unit.element.appendChild(choose);
      for(const data of x.units||[]){const o=document.createElement("option");o.value=String(data.birimId);o.textContent=String(data.birimAdi);unit.element.appendChild(o)}
      unit.element.disabled=!(x.units||[]).length;
      ui.status.textContent=unit.element.disabled?"Bu il için doğrulanmış CBS birimi yok.":"Başsavcılık, taraf adı ve tarih aralığı seçin.";
    }catch(e){if(current===revision&&alive())ui.status.textContent="CBS birimleri alınamadı: "+e.message}
  };
  unit.element.onchange=()=>{button.disabled=!unit.element.value||busy};
  button.onclick=async()=>{
    if(busy||button.disabled||!alive())return;
    const days=(Date.parse(to.element.value+"T00:00:00Z")-Date.parse(from.element.value+"T00:00:00Z"))/86400000+1;
    if(!name.element.value.trim()||!Number.isFinite(days)||days<1||days>120||!unit.element.value){
      ui.status.textContent="Tam taraf adı, başsavcılık ve 1–120 günlük tarih aralığı gerekli.";return;
    }
    if(!confirm("Seçilen CBS'de tam taraf adı sorgulansın mı? Dosya indirme başlatılmayacak."))return;
    const current=++revision;clearPoll();busy=true;button.disabled=true;province.element.disabled=true;unit.element.disabled=true;
    ui.results.hidden=true;ui.results.replaceChildren();
    ui.status.textContent="CBS taraf sorgusu kuyruğa gönderiliyor…";
    try{
      const v=status.element.value,statuses=v==="open"?[0]:v==="closed"?[1]:[0,1];
      const reply=await api.searchUyapCbsParty({
        ilKodu:Number(province.element.value),birimId:unit.element.value,partyName:name.element.value.trim(),
        openedFrom:from.element.value,openedTo:to.element.value,statuses,maxCandidates:25
      });
      if(!alive()||current!==revision)return;
      if(reply.accepted!==true||!reply.searchId)throw new Error("CBS araması kabul edilmedi veya kimliği yok");
      async function poll(){
        if(!alive()||current!==revision)return;
        try{
          const x=await api.uyapCbsPartySearchStatus(reply.searchId);
          if(!alive()||current!==revision)return;
          if(x.contractVersion!=="uyap.targeted-cbs-party-search.v1")throw new Error("CBS durum API sürümü uyumsuz");
          ui.status.textContent=String(x.label||x.state||"Sorgu devam ediyor")+" · Kontrol edilen aday: "+Number(x.partyChecks||0);
          if(Array.isArray(x.matches)&&x.matches.length)addResult(ui.results,"Taraf bilgileriyle eşleşen soruşturma dosyaları",x.matches);
          if(x.terminal===true){release();return}
          pollTimer=setTimeout(poll,Math.max(1000,Math.min(15000,Number(x.pollAfterMs)||3000)));
        }catch(e){if(current===revision&&alive()){ui.status.textContent="Sorgu durumu alınamadı: "+e.message;release()}}
      }
      await poll();
    }catch(e){if(current===revision&&alive()){ui.status.textContent="CBS araması başlatılamadı: "+e.message;release()}}
  };
}
export function mountCbsCaseHandoff(api,schema){
  const anchor=document.querySelector(".case-query");
  if(!anchor||document.querySelector(".case-cbs-handoff"))return;
  const host=document.createElement("div");host.className="case-cbs-handoff";
  anchor.after(host);
  bindIncomingWatcher(api,host);
  bindCbsPartySearch(api,host,schema);
}
