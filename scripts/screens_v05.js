const {execFileSync}=require("child_process");
const fs=require("fs");
const path=require("path");
const ROOT=path.join(__dirname,"..");
const chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shots=[
 ["01_bugun","http://127.0.0.1:47831/#today"],
 ["02_dosyalar","http://127.0.0.1:47831/#cases"],
 ["03_f1_foy","http://127.0.0.1:47831/#cases/1"],
 ["04_takvim","http://127.0.0.1:47831/#calendar"],
 ["05_belgeler","http://127.0.0.1:47831/#documents"],
 ["06_vekaletler","http://127.0.0.1:47831/#powers"]
];
for(const [name,url] of shots){
 const out=path.join(ROOT,"data","screens",name+".png");
 try{execFileSync(chrome,["--headless=new","--disable-gpu","--no-first-run","--hide-scrollbars","--window-size=1672,941","--virtual-time-budget=5000","--screenshot="+out,url],{stdio:"ignore",timeout:15000});console.log(out)}catch(e){console.log("ERR",name,e.message)}
}