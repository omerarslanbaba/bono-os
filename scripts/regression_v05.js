const db=require("../bridge/db");
const v05=require("../bridge/v05");
function assert(x,m){if(!x)throw new Error(m)}
const uid="__v05test_"+Date.now();
let clientId,fileId,caseId;
try{
  clientId=Number(db.prepare("INSERT INTO clients(display_name,client_type,notes) VALUES(?,?,?)").run(uid,"person","temp").lastInsertRowid);
  fileId=Number(db.prepare("INSERT INTO office_files(file_no,title,status,primary_client_id) VALUES(?,?,?,?)").run(uid,uid,"test",clientId).lastInsertRowid);
  caseId=Number(db.prepare("INSERT INTO cases(external_id,office_file_no,court,court_file_no,case_type,status,client_name,office_file_id) VALUES(?,?,?,?,?,?,?,?)").run(uid,uid,"Test Mahkemesi","2099/1","test","open",uid,fileId).lastInsertRowid);
  const b=v05.ingestRemoteManifest(caseId,[
    {remoteDocumentId:"A",title:"Tensip",documentType:"Tensip",documentDate:"2099-01-01",fileName:"a.udf"},
    {remoteDocumentId:"B",title:"Dilekçe",documentType:"Dilekçe",documentDate:"2099-01-02",fileName:"b.udf"}
  ],{manifestType:"baseline",source:"local_test"});
  assert(b.newCount===2,"baseline newCount");
  const docs=db.prepare("SELECT id FROM uyap_remote_documents WHERE case_id=? ORDER BY id").all(caseId);
  docs.forEach(d=>v05.markRemoteDownloaded(d.id,"C:\\BONO_TEST\\dummy.udf","testhash"));
  const completed=v05.completeBaseline(caseId);assert(completed.sync_mode==="delta","delta mode");
  const d=v05.ingestRemoteManifest(caseId,[
    {remoteDocumentId:"A",title:"Tensip",documentType:"Tensip",fileName:"a.udf"},
    {remoteDocumentId:"B",title:"Dilekçe",documentType:"Dilekçe",fileName:"b.udf"},
    {remoteDocumentId:"C",title:"Bilirkişi Raporu",documentType:"Bilirkişi Raporu",documentDate:"2099-01-03",fileName:"c.pdf"}
  ],{manifestType:"delta",source:"local_test"});
  const pending=v05.pendingRemoteDocuments(caseId,true);
  assert(d.newCount===1,"delta one new");assert(pending.length===1&&pending[0].remote_document_id==="C","only C pending");
  const cr=v05.createCorrespondence({officeFileId:fileId,caseId,institution:"BTK",subject:"HTS kayıtları",sentAt:"2099-01-05",status:"sent"});
  const issue=v05.createEvidenceIssue({officeFileId:fileId,caseId,issueType:"isnat",title:"İletişim bağlantısı"});
  v05.addEvidenceLink(issue.id,{linkType:"correspondence",evidenceRole:"missing",correspondenceId:cr.id,title:"BTK müzekkere cevabı",status:"expected"});
  assert(v05.evidenceMatrix(fileId)[0].links.length===1,"evidence correspondence link");
  console.log(JSON.stringify({ok:true,baseline:b,newDelta:d.newCount,pending:pending.map(x=>x.remote_document_id),correspondence:true,evidence:true}));
}finally{
  if(caseId)db.prepare("DELETE FROM cases WHERE id=?").run(caseId);
  if(fileId)db.prepare("DELETE FROM office_files WHERE id=?").run(fileId);
  if(clientId)db.prepare("DELETE FROM clients WHERE id=?").run(clientId);
}