import sys,sqlite3,json,re,unicodedata
from pathlib import Path
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/"data"/"bono.db"

def norm(s):
    s=(s or "").replace("İ","I").replace("ı","i")
    s=unicodedata.normalize("NFKD",s)
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

def kind_from(name, current):
    x=norm((current or "")+" "+(name or ""))
    if "mazbata" in x or "tebligat" in x or "teblig " in x: return "tebligat"
    if "muzekkere" in x: return "müzekkere_cevabı" if "cevap" in x else "müzekkere"
    if "durusma" in x and ("zapt" in x or "tutanak" in x): return "duruşma_tutanağı"
    if "tensip" in x: return "tensip"
    if "bilirkisi" in x or "rapor" in x: return "rapor"
    if "iddianame" in x: return "iddianame"
    if "karar" in x: return "karar"
    if "dilekce" in x or "beyan" in x or "savunma" in x: return "dilekce"
    return current or "belge"

def case_link(con,row):
    office_file_id=row["suggested_office_file_id"] or None
    case_id=None
    if office_file_id:
        c=con.execute("SELECT id FROM cases WHERE office_file_id=? ORDER BY id LIMIT 1",(office_file_id,)).fetchone()
        if c: case_id=c["id"]
    m=re.match(r"(20\d{2})_(\d+)",row["file_name"])
    if m:
        cno=f"{m.group(1)}/{m.group(2)}"
        c=con.execute("SELECT id,office_file_id FROM cases WHERE replace(court_file_no,' ','') LIKE ? ORDER BY id LIMIT 1",("%"+cno+"%",)).fetchone()
        if c: case_id=c["id"];office_file_id=c["office_file_id"]
    return office_file_id,case_id

def main(limit=0):
    con=sqlite3.connect(DB,timeout=30);con.execute("PRAGMA busy_timeout=30000");con.row_factory=sqlite3.Row
    rows=con.execute("""SELECT a.id,a.file_name,a.classification,a.suggested_office_file_id,l.local_path,da.engine_version,da.analysis_status
      FROM local_assets a JOIN asset_locations l ON l.asset_id=a.id
      LEFT JOIN document_analysis da ON da.asset_id=a.id
      WHERE lower(a.extension)='.pdf' AND (da.asset_id IS NULL OR COALESCE(da.engine_version,'')!='pdftext-v0.9')
      GROUP BY a.id ORDER BY a.id""").fetchall()
    if limit: rows=rows[:limit]
    done=no_text=failed=chunks_n=0
    for row in rows:
        aid=row["id"];p=Path(row["local_path"])
        try:
            if not p.exists(): continue
            reader=PdfReader(str(p),strict=False)
            page_texts=[]
            for i,page in enumerate(reader.pages[:250]):
                try: txt=(page.extract_text() or "").strip()
                except Exception: txt=""
                if txt: page_texts.append((i+1,txt))
            raw="\n\n".join(t for _,t in page_texts)
            kind=kind_from(row["file_name"],row["classification"])
            office_file_id,case_id=case_link(con,row)
            status="completed" if len(raw.strip())>=40 else "no_text"
            con.execute("""INSERT INTO document_analysis(asset_id,document_kind,raw_text,extracted_json,sections_json,style_profile_json,template_score,analysis_status,engine_version,analyzed_at,error)
              VALUES(?,?,?,?,?,'{}',0,?,'pdftext-v0.9',datetime('now'),NULL)
              ON CONFLICT(asset_id) DO UPDATE SET document_kind=excluded.document_kind,raw_text=excluded.raw_text,
              extracted_json=excluded.extracted_json,sections_json=excluded.sections_json,analysis_status=excluded.analysis_status,
              engine_version='pdftext-v0.9',analyzed_at=datetime('now'),error=NULL""",
              (aid,kind,raw,json.dumps({"pageCount":len(reader.pages),"textPages":len(page_texts)},ensure_ascii=False),
               json.dumps([{"page":n,"chars":len(t)} for n,t in page_texts],ensure_ascii=False),status))
            if status=="completed":
                con.execute("DELETE FROM knowledge_chunks WHERE asset_id=?",(aid,))
                for idx,(page_no,txt) in enumerate(page_texts):
                    for part_no,start in enumerate(range(0,len(txt),6000)):
                        chunk=txt[start:start+6000].strip()
                        if not chunk: continue
                        con.execute("""INSERT INTO knowledge_chunks(asset_id,office_file_id,case_id,chunk_no,heading,text,normalized_text,metadata_json)
                          VALUES(?,?,?,?,?,?,?,?)""",(aid,office_file_id,case_id,idx*1000+part_no,f"Sayfa {page_no}",chunk,norm(chunk),
                          json.dumps({"fileName":row["file_name"],"kind":kind,"page":page_no},ensure_ascii=False)))
                        chunks_n+=1
                body=raw[:20000]
                con.execute("""INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at)
                  VALUES('asset',?,?,?,?,?,datetime('now'))
                  ON CONFLICT(entity_type,entity_id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,body=excluded.body,
                  normalized_text=excluded.normalized_text,updated_at=datetime('now')""",
                  (str(aid),row["file_name"],"PDF · "+kind,body,norm(row["file_name"]+" "+kind+" "+body)))
                done+=1
            else: no_text+=1
            if (done+no_text)%10==0: con.commit()
        except Exception as e:
            con.execute("""INSERT INTO document_analysis(asset_id,analysis_status,engine_version,analyzed_at,error)
              VALUES(?,'failed','pdftext-v0.9',datetime('now'),?)
              ON CONFLICT(asset_id) DO UPDATE SET analysis_status='failed',engine_version='pdftext-v0.9',analyzed_at=datetime('now'),error=excluded.error""",(aid,str(e)[:1500]))
            failed+=1
    con.execute("""INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json)
      VALUES(datetime('now'),'system','index_pdf_library','batch',NULL,?)""",(json.dumps({"seen":len(rows),"done":done,"noText":no_text,"failed":failed,"chunks":chunks_n},ensure_ascii=False),))
    con.commit()
    print(json.dumps({"seen":len(rows),"done":done,"noText":no_text,"failed":failed,"chunksWritten":chunks_n},ensure_ascii=False))
    con.close()

if __name__=="__main__":
    main(int(sys.argv[1]) if len(sys.argv)>1 else 0)
