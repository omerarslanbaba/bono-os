const fs=require("fs");
const db=require("../bridge/db");
const v04=require("../bridge/v04");
const adapter=require("../bridge/udf_adapter");

(async()=>{
  const t=db.prepare("SELECT id FROM petition_templates WHERE is_office_style=1 AND active=1 ORDER BY CASE WHEN COALESCE(header_text,'')<>'' THEN 0 ELSE 1 END,id LIMIT 1").get();
  if(!t) throw new Error("Ofis stil adayı yok");
  const d=v04.createDraft({
    draftType:"technical_test",
    title:"BONO UDF Teknik Test",
    templateId:t.id,
    contentMd:"|**TEKNİK TEST**\n\n**DOSYA NO** : TEST/1\n\n|**AÇIKLAMALAR**\n\nBONO v0.4 UDF adapter doğrulaması."
  });
  try{
    const r=await adapter.exportDraft(d.id);
    console.log(JSON.stringify({ok:r.ok,validation:r.validation,styleApplied:r.built.styleApplied,templateId:t.id}));
    if(!r.ok||r.validation.hasSignature) throw new Error("UDF export doğrulaması başarısız");
    if(r.path&&fs.existsSync(r.path)) fs.unlinkSync(r.path);
  } finally {
    db.prepare("DELETE FROM drafts WHERE id=?").run(d.id);
  }
})().catch(e=>{console.error(e);process.exit(1)});
