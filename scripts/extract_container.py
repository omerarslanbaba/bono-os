import sys, os, json, zipfile, shutil
from pathlib import Path

src=Path(sys.argv[1])
dest=Path(sys.argv[2])
dest.mkdir(parents=True,exist_ok=True)
allowed={'.pdf','.udf','.doc','.docx','.txt','.rtf','.xls','.xlsx','.tif','.tiff','.html','.htm','.jpg','.jpeg','.png','.zip','.eyp'}
out={"source":str(src),"extracted":[],"skipped":[],"error":None}
try:
    if not zipfile.is_zipfile(src):
        raise ValueError("Paket ZIP/EYP arşivi olarak açılamadı")
    with zipfile.ZipFile(src) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name=Path(info.filename).name
            ext=Path(name).suffix.lower()
            if not name or ext not in allowed:
                out["skipped"].append(info.filename)
                continue
            # path traversal yok; yalnız dosya adı + çakışma güvenliği
            target=dest/name
            n=2
            while target.exists():
                target=dest/(Path(name).stem+f" ({n})"+ext); n+=1
            with z.open(info) as r, open(target,"wb") as w:
                shutil.copyfileobj(r,w)
            out["extracted"].append(str(target))
except Exception as e:
    out["error"]=str(e)
print(json.dumps(out,ensure_ascii=True))
