const db=require("./db");

function parseDate(s){
  const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) throw new Error("Tarih YYYY-MM-DD olmalı");
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
  if(Number.isNaN(d.getTime())) throw new Error("Geçersiz tarih");
  return d;
}
function fmt(d){return d.toISOString().slice(0,10)}
function addDays(d,n){
  const x=new Date(d.getTime());
  x.setUTCDate(x.getUTCDate()+Number(n||0));
  return x;
}
function calendarDay(date){
  return db.prepare("SELECT date,label,day_type,source,verified_at FROM legal_calendar_days WHERE date=?").get(date);
}
function nonWorking(d){
  const dow=d.getUTCDay(),cal=calendarDay(fmt(d));
  return {nonWorking:dow===0||dow===6||!!cal,weekend:dow===0||dow===6,calendar:cal||null};
}
function calculate(input={}){
  const trigger=parseDate(input.triggerDate);
  const deliveryMode=input.deliveryMode||"manual";
  const trace=[],warnings=[];
  let deemed=trigger;
  trace.push({step:"trigger",date:fmt(trigger),label:"Başlangıç / sistemde görülen tarih"});
  if(deliveryMode==="uets"){
    deemed=addDays(trigger,5);
    trace.push({step:"uets_deemed_service",date:fmt(deemed),daysAdded:5,label:"UETS: ulaştığı tarihi izleyen beşinci günün sonu"});
  }else{
    const offset=Number(input.triggerOffsetDays||0);
    if(offset){
      deemed=addDays(trigger,offset);
      trace.push({step:"custom_trigger_offset",date:fmt(deemed),daysAdded:offset,label:"Kullanıcı tanımlı tebliğ/başlangıç ofseti"});
    }
  }

  const periodDays=Number(input.periodDays);
  if(!Number.isInteger(periodDays)||periodDays<0||periodDays>3650)
    throw new Error("Süre gün sayısı 0-3650 arasında tam sayı olmalı");
  const countFromNextDay=input.countFromNextDay!==false;
  const countStart=countFromNextDay?addDays(deemed,1):deemed;
  trace.push({step:"count_start",date:fmt(countStart),label:countFromNextDay?"Sayım ertesi gün başlatıldı":"Sayım aynı gün başlatıldı"});
  let due=periodDays===0?countStart:addDays(countStart,periodDays-1);
  trace.push({step:"raw_due",date:fmt(due),periodDays,label:"Ham son gün"});

  if(input.adjustNonWorkingDay!==false){
    const skipped=[];
    let guard=0;
    while(nonWorking(due).nonWorking && guard<20){
      const nw=nonWorking(due);
      skipped.push({date:fmt(due),reason:nw.calendar?.label||(nw.weekend?"Hafta sonu":"Çalışma dışı gün")});
      due=addDays(due,1);
      guard++;
    }
    if(skipped.length)
      trace.push({step:"non_working_adjustment",from:skipped[0].date,date:fmt(due),skipped,label:"İş günü düzeltmesi"});
  }

  const verified=db.prepare("SELECT COUNT(*) n FROM legal_calendar_days WHERE verified_at IS NOT NULL").get().n;
  if(verified===0)
    warnings.push("Doğrulanmış resmi tatil takvimi henüz bağlı değil; hafta sonu dışındaki çalışma dışı günler ayrıca kontrol edilmelidir.");
  warnings.push("Bu hesap taslaktır; süre türüne özgü özel kanun hükümleri ve başlangıç kuralları avukat tarafından doğrulanmalıdır.");
  if(deliveryMode==="uets")
    warnings.push("UETS +5 kuralı kanuni tebliğ tarihini belirler; devam eden sürenin başlangıcı ilgili usul hükmüne göre ayrıca kontrol edilmelidir.");

  return {
    triggerDate:fmt(trigger),deemedServiceDate:fmt(deemed),countStartDate:fmt(countStart),
    dueDate:fmt(due),deliveryMode,periodDays,countFromNextDay,
    adjustNonWorkingDay:input.adjustNonWorkingDay!==false,
    trace,warnings,confidence:"draft",lawyerApproved:false
  };
}
function saveDraft(input={}){
  if(!String(input.title||"").trim()) throw new Error("Süre başlığı gerekli");
  const result=calculate(input);
  const r=db.prepare(
    "INSERT INTO deadlines(case_id,notification_id,title,legal_basis,starts_at,due_at,calculation_json,confidence,lawyer_approved,status,source) "+
    "VALUES(?,?,?,?,?,?,?,'draft',0,'open','BONO Deadline Engine')"
  ).run(
    input.caseId||null,input.notificationId||null,String(input.title).trim(),
    input.legalBasis||null,result.countStartDate,result.dueDate,JSON.stringify({input,result})
  );
  return {id:Number(r.lastInsertRowid),...result};
}
function calendarDays(limit=400){
  return db.prepare("SELECT * FROM legal_calendar_days ORDER BY date LIMIT ?").all(Number(limit)||400);
}
function upsertCalendarDay(b={}){
  parseDate(b.date);
  if(!String(b.label||"").trim()) throw new Error("Takvim günü açıklaması gerekli");
  db.prepare(
    "INSERT INTO legal_calendar_days(date,label,day_type,source,verified_at) VALUES(?,?,?,?,?) "+
    "ON CONFLICT(date) DO UPDATE SET label=excluded.label,day_type=excluded.day_type,source=excluded.source,verified_at=excluded.verified_at"
  ).run(b.date,String(b.label).trim(),b.dayType||"holiday",b.source||"manual",b.verified?new Date().toISOString():null);
  return calendarDay(b.date);
}
module.exports={calculate,saveDraft,calendarDays,upsertCalendarDay};
