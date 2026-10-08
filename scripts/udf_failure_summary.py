import sqlite3,collections,re,json
from pathlib import Path
db=Path(__file__).resolve().parents[1]/"data"/"bono.db"
con=sqlite3.connect(db)
rows=con.execute("select error from document_analysis where analysis_status='failed'").fetchall()
cnt=collections.Counter()
for (e,) in rows:
    s=(e or "unknown").splitlines()[0]
    s=re.sub(r"[A-Z]:\\[^ ]+","[path]",s)
    s=re.sub(r"\d+","N",s)
    cnt[s[:180]]+=1
print(json.dumps({"failed":len(rows),"categories":cnt.most_common()},ensure_ascii=False))
