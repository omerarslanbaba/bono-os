import sys,sqlite3,json,re,unicodedata,traceback
from pathlib import Path
from udf_engine import analyze

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/"data"/"bono.db"

def norm(s):
    s=(s or "").replace("İ","I").replace("ı","i")
    s=unicodedata.normalize("NFKD",s)
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

def main(limit=0):
    con=sqlite3.connect(DB,timeout=30)
    con.execute("PRAGMA busy_timeout=30000")
    con.row_factory=sqlite3.Row
    sql="""SELECT a.id,a.file_name,a.classification,a.suggested_office_file_id,l.local_path
      FROM local_assets a JOIN asset_locations l ON l.asset_id=a.id
      WHERE lower(a.extension)='.udf'
      GROUP BY a.id ORDER BY a.id"""
    rows=con.execute(sql).fetchall()
    if limit: rows=rows[:limit]
    done=failed=templates=chunks_n=0
    for row in rows:
        aid=row["id"]; path=row["local_path"]
        try:
            if not Path(path).exists(): continue
            a=analyze(path)
            fields=a["fields"]; sections=a["sections"]; style=a["styleProfile"]
            office_marker=any(x in a["rawText"].upper() for x in ["BONO HUKUK","YUSUF ÖMER ARSLANBABA","ÖMER ARSLANBABA"])
            con.execute("""INSERT INTO document_analysis(asset_id,document_kind,raw_text,extracted_json,sections_json,style_profile_json,template_score,analysis_status,engine_version,analyzed_at,error)
              VALUES(?,?,?,?,?,?,?,'completed','udf-v0.5',datetime('now'),NULL)
              ON CONFLICT(asset_id) DO UPDATE SET document_kind=excluded.document_kind,raw_text=excluded.raw_text,
                extracted_json=excluded.extracted_json,sections_json=excluded.sections_json,style_profile_json=excluded.style_profile_json,
                template_score=excluded.template_score,analysis_status='completed',engine_version=excluded.engine_version,analyzed_at=datetime('now'),error=NULL""",
              (aid,a["kind"],a["rawText"],json.dumps(fields,ensure_ascii=False),json.dumps(sections,ensure_ascii=False),json.dumps(style,ensure_ascii=False),a["templateScore"]))
            con.execute("UPDATE local_assets SET classification=? WHERE id=?",(a["kind"],aid))
            con.execute("DELETE FROM knowledge_chunks WHERE asset_id=?",(aid,))
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
            for i,ch in enumerate(a["chunks"]):
                con.execute("""INSERT INTO knowledge_chunks(asset_id,office_file_id,case_id,chunk_no,heading,text,normalized_text,metadata_json)
                  VALUES(?,?,?,?,?,?,?,?)""",(aid,office_file_id,case_id,i,ch.get("heading"),ch["text"],norm(ch["text"]),json.dumps({"fileName":row["file_name"],"kind":a["kind"]},ensure_ascii=False)))
                chunks_n+=1
            body=a["rawText"][:20000]
            con.execute("""INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at)
              VALUES('asset',?,?,?,?,?,datetime('now'))
              ON CONFLICT(entity_type,entity_id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,body=excluded.body,
                normalized_text=excluded.normalized_text,updated_at=datetime('now')""",
              (str(aid),row["file_name"],"UDF · "+a["kind"],body,norm(row["file_name"]+" "+a["kind"]+" "+body)))
            if a["templateScore"]>=0.55:
                ex=con.execute("SELECT id FROM petition_templates WHERE source_asset_id=?",(aid,)).fetchone()
                if not ex:
                    con.execute("""INSERT INTO petition_templates(name,petition_type,source_asset_id,is_office_style,style_profile_json,structure_json,header_text,footer_text)
                      VALUES(?,?,?,?,?,?,?,?)""",(row["file_name"],a["kind"],aid,1 if office_marker else 0,json.dumps(style,ensure_ascii=False),
                        json.dumps({"sections":[s["heading"] for s in sections],"paragraphCount":style.get("paragraphCount",0)},ensure_ascii=False),
                        style.get("headerText"),style.get("footerText")))
                    templates+=1
            done+=1
            if done%20==0: con.commit()
        except Exception as e:
            con.execute("""INSERT INTO document_analysis(asset_id,analysis_status,engine_version,analyzed_at,error)
              VALUES(?,'failed','udf-v0.5',datetime('now'),?)
              ON CONFLICT(asset_id) DO UPDATE SET analysis_status='failed',engine_version='udf-v0.5',analyzed_at=datetime('now'),error=excluded.error""",(aid,str(e)[:1500]))
            failed+=1
    con.execute("""INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json)
      VALUES(datetime('now'),'system','index_udf_library','batch',NULL,?)""",(json.dumps({"seen":len(rows),"done":done,"failed":failed,"templatesAdded":templates,"chunks":chunks_n},ensure_ascii=False),))
    con.commit()
    total=con.execute("SELECT COUNT(*) FROM document_analysis WHERE analysis_status='completed'").fetchone()[0]
    templ=con.execute("SELECT COUNT(*) FROM petition_templates WHERE active=1").fetchone()[0]
    office=con.execute("SELECT COUNT(*) FROM petition_templates WHERE active=1 AND is_office_style=1").fetchone()[0]
    print(json.dumps({"seen":len(rows),"done":done,"failed":failed,"analysisTotal":total,"templatesTotal":templ,"officeStyleCandidates":office,"chunksWritten":chunks_n},ensure_ascii=False))
    con.close()

if __name__=="__main__":
    limit=int(sys.argv[1]) if len(sys.argv)>1 else 0
    main(limit)
