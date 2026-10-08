import os, re, sqlite3, hashlib, json, unicodedata, zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET
from pathlib import Path

DESKTOP = Path(os.environ.get("USERPROFILE","C:/Users/omera")) / "OneDrive" / "Masaüstü"
BONO = DESKTOP / "BONO_OS"
SRC = DESKTOP / "Vekaletnameler"
XLSX = SRC / "Vekaletnameler.xlsx"
DB = BONO / "data" / "bono.db"

NS = {"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def norm(s):
    s = "" if s is None else str(s)
    s = s.replace("İ","I").replace("ı","i")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

def xlsx_rows(path):
    with zipfile.ZipFile(path) as z:
        shared=[]
        if "xl/sharedStrings.xml" in z.namelist():
            root=ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si",NS):
                texts=[t.text or "" for t in si.findall(".//m:t",NS)]
                shared.append("".join(texts))
        sheet=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        rows=[]
        for row in sheet.findall(".//m:sheetData/m:row",NS):
            vals=[]
            for c in row.findall("m:c",NS):
                ref=c.attrib.get("r","A1")
                col=re.match(r"([A-Z]+)",ref).group(1)
                idx=0
                for ch in col:
                    idx=idx*26+(ord(ch)-64)
                idx-=1
                while len(vals)<=idx: vals.append(None)
                typ=c.attrib.get("t")
                v=c.find("m:v",NS)
                if typ=="inlineStr":
                    t=c.find(".//m:t",NS)
                    val=t.text if t is not None else ""
                elif v is None:
                    val=None
                elif typ=="s":
                    val=shared[int(v.text)]
                else:
                    val=v.text
                vals[idx]=val
            rows.append(vals)
        return rows

def excel_date(v):
    if not v: return None
    s=str(v)
    try:
        if "T" in s or "-" in s:
            return s[:10]
        n=float(s)
        dt=datetime(1899,12,30)+timedelta(days=n)
        return dt.date().isoformat()
    except:
        return s

def main():
    con=sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys=ON")
    con.row_factory=sqlite3.Row
    rows=xlsx_rows(XLSX)
    if not rows: raise SystemExit("Excel boş")
    headers=[str(x or "").strip() for x in rows[0]]
    ix={h:i for i,h in enumerate(headers) if h}
    imported=0; linked_files=0; created_clients=0
    files=[p for p in SRC.iterdir() if p.is_file() and p.suffix.lower() in {".pdf",".jpg",".jpeg",".png"}]

    for r in rows[1:]:
        if not r or not r[ix.get("MÜVEKKİL",1)]: continue
        def get(h):
            i=ix.get(h)
            return r[i] if i is not None and i < len(r) else None

        name=str(get("MÜVEKKİL")).strip()
        nid=str(get("TCKN") or "").split(".")[0].strip() or None
        notary=str(get("NOTER") or "").strip() or None
        journal=str(get("YEVMİYE NO") or "").split(".")[0].strip() or None
        issued=excel_date(get("TARİH"))
        seq=str(get("SIRA") or "").strip() or None

        client=None
        if nid:
            client=con.execute("SELECT id FROM clients WHERE national_id=?",(nid,)).fetchone()
        if not client:
            client=con.execute("SELECT id FROM clients WHERE display_name=? ORDER BY id LIMIT 1",(name,)).fetchone()
        if client:
            client_id=client["id"]
            con.execute("UPDATE clients SET display_name=?, national_id=COALESCE(national_id,?), updated_at=datetime('now') WHERE id=?",(name,nid,client_id))
        else:
            cur=con.execute("INSERT INTO clients(display_name,national_id) VALUES(?,?)",(name,nid))
            client_id=cur.lastrowid; created_clients+=1

        fp_raw="|".join([nid or norm(name),norm(notary),journal or "",issued or ""])
        fp=hashlib.sha256(fp_raw.encode("utf-8")).hexdigest()
        row=con.execute("SELECT id FROM powers_of_attorney WHERE fingerprint=?",(fp,)).fetchone()
        if row:
            power_id=row["id"]
            con.execute("UPDATE powers_of_attorney SET notary=?, journal_no=?, issued_at=?, updated_at=datetime('now') WHERE id=?",(notary,journal,issued,power_id))
        else:
            cur=con.execute("""INSERT INTO powers_of_attorney
                (client_id,notary,journal_no,issued_at,fingerprint,notes)
                VALUES(?,?,?,?,?,?)""",(client_id,notary,journal,issued,fp,("Eski sıra: "+seq) if seq else None))
            power_id=cur.lastrowid
            imported+=1

        con.execute("""INSERT OR IGNORE INTO power_sources
            (power_id,source_type,source_ref,local_path,metadata_json)
            VALUES(?,?,?,?,?)""",(power_id,"excel",str(XLSX),None,json.dumps({"legacy_order":seq},ensure_ascii=False)))

        nname=norm(name)
        name_tokens=[t for t in nname.split() if len(t)>2]
        matches=[]
        for f in files:
            nf=norm(f.stem)
            if nname and nname in nf:
                matches.append(f)
            elif len(name_tokens)>=2 and all(t in nf for t in name_tokens):
                matches.append(f)
        for f in matches:
            con.execute("""INSERT OR IGNORE INTO power_sources
                (power_id,source_type,source_ref,local_path,metadata_json)
                VALUES(?,?,?,?,?)""",(power_id,"local_document",f.name,str(f),None))
            linked_files += con.total_changes > 0

        body=" ".join(x for x in [name,notary,journal,issued] if x)
        ntext=norm(body)
        con.execute("""INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at)
            VALUES('client',?,?,?,?,?,datetime('now'))
            ON CONFLICT(entity_type,entity_id) DO UPDATE SET
              title=excluded.title,subtitle=excluded.subtitle,body=excluded.body,
              normalized_text=excluded.normalized_text,updated_at=datetime('now')""",
            (str(client_id),name,"Müvekkil",body,ntext))
        con.execute("""INSERT INTO search_index(entity_type,entity_id,title,subtitle,body,normalized_text,updated_at)
            VALUES('power',?,?,?,?,?,datetime('now'))
            ON CONFLICT(entity_type,entity_id) DO UPDATE SET
              title=excluded.title,subtitle=excluded.subtitle,body=excluded.body,
              normalized_text=excluded.normalized_text,updated_at=datetime('now')""",
            (str(power_id),f"{name} vekâlet","Vekâlet",body,ntext))

    con.execute("""INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json)
        VALUES(datetime('now'),'system','import_vekalet','batch',NULL,?)""",
        (json.dumps({"rows":len(rows)-1,"new_clients":created_clients,"new_powers":imported},ensure_ascii=False),))
    con.commit()
    summary={
        "rows_seen":len(rows)-1,
        "new_clients":created_clients,
        "new_powers":imported,
        "clients_total":con.execute("SELECT COUNT(*) FROM clients").fetchone()[0],
        "powers_total":con.execute("SELECT COUNT(*) FROM powers_of_attorney").fetchone()[0],
        "document_sources_total":con.execute("SELECT COUNT(*) FROM power_sources WHERE source_type='local_document'").fetchone()[0]
    }
    print(json.dumps(summary,ensure_ascii=False))
    con.close()

if __name__=="__main__":
    main()
