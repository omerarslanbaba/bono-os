const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'});
export function calendarDate(value){
 if(!value)return null;
 const text=String(value);
 if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
 const d=new Date(text);return Number.isNaN(d.getTime())?null:formatter.format(d);
}
export function nextSevenDays(rows,field,now=new Date()){
 const start=formatter.format(now),end=new Date(start+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+7);
 const exclusive=end.toISOString().slice(0,10);
 return rows.filter(r=>{const d=calendarDate(r[field]);return d&&d>=start&&d<exclusive}).sort((a,b)=>String(a[field]).localeCompare(String(b[field])));
}
