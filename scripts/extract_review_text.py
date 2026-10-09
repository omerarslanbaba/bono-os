import sys, json, zipfile, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))

def clean_error(e):
    return str(e).replace("\r"," ").replace("\n"," ")[:1500]

def extract_pdf(p):
    try:
        from pypdf import PdfReader
        reader=PdfReader(str(p),strict=False)
        refs=[]; raw=[]
        for i,page in enumerate(reader.pages[:500]):
            try:
                txt=(page.extract_text() or "").strip()
            except Exception:
                txt=""
            if txt:
                refs.append({"kind":"page","page":i+1,"text":txt})
                raw.append(txt)
        text="\n\n".join(raw)
        if len(text.strip())<40:
            return {"ok":True,"format":"pdf","status":"no_text","engine":"review-pdf-v0.1",
                    "rawText":"","pageCount":len(reader.pages),"references":[],
                    "reason":"no_embedded_text_or_scan_requires_ocr"}
        return {"ok":True,"format":"pdf","status":"extracted","engine":"review-pdf-v0.1",
                "rawText":text,"pageCount":len(reader.pages),"references":refs}
    except Exception as e:
        return {"ok":False,"format":"pdf","status":"failed","engine":"review-pdf-v0.1","rawText":"",
                "references":[],"reason":"pdf_parse_failed","error":clean_error(e)}

def extract_udf(p):
    try:
        from udf_engine import analyze
        a=analyze(str(p))
        refs=[]
        for s in a.get("sections") or []:
            refs.append({"kind":"section","heading":s.get("heading"),"startParagraph":s.get("startParagraph"),"text":s.get("text") or ""})
        if not refs:
            for idx,ch in enumerate(a.get("chunks") or []):
                refs.append({"kind":"chunk","chunk":idx,"heading":ch.get("heading"),"text":ch.get("text") or ""})
        raw=a.get("rawText") or ""
        status="extracted" if raw.strip() else "no_text"
        return {"ok":True,"format":"udf","status":status,"engine":"review-udf-v0.1",
                "rawText":raw,"references":refs,"documentKind":a.get("kind"),
                "fields":a.get("fields") or {},"sections":a.get("sections") or [],
                "reason":None if status=="extracted" else "udf_has_no_text"}
    except Exception as e:
        return {"ok":False,"format":"udf","status":"failed","engine":"review-udf-v0.1","rawText":"",
                "references":[],"reason":"udf_parse_failed","error":clean_error(e)}

def extract_container(p):
    try:
        if not zipfile.is_zipfile(p):
            raise ValueError("Paket ZIP/EYP arşivi olarak açılamadı")
        with zipfile.ZipFile(p) as z:
            members=[]
            for info in z.infolist():
                if info.is_dir():
                    continue
                members.append({"name":Path(info.filename).name,"path":info.filename,"size":info.file_size})
        return {"ok":True,"format":p.suffix.lower().lstrip("."),"status":"container","engine":"review-container-v0.1",
                "rawText":"","references":[],"members":members,
                "reason":"container_requires_member_review"}
    except Exception as e:
        return {"ok":False,"format":p.suffix.lower().lstrip("."),"status":"failed","engine":"review-container-v0.1",
                "rawText":"","references":[],"reason":"container_parse_failed","error":clean_error(e)}

def extract_text_file(p):
    try:
        raw=p.read_text(encoding="utf-8",errors="replace")
        return {"ok":True,"format":p.suffix.lower().lstrip("."),"status":"extracted" if raw.strip() else "no_text",
                "engine":"review-text-v0.1","rawText":raw,
                "references":[{"kind":"document","text":raw}] if raw.strip() else [],
                "reason":None if raw.strip() else "empty_text"}
    except Exception as e:
        return {"ok":False,"format":p.suffix.lower().lstrip("."),"status":"failed","engine":"review-text-v0.1",
                "rawText":"","references":[],"reason":"text_parse_failed","error":clean_error(e)}

def main():
    p=Path(sys.argv[1]).resolve()
    if not p.exists() or not p.is_file():
        out={"ok":False,"format":p.suffix.lower().lstrip("."),"status":"failed","engine":"review-v0.1",
             "rawText":"","references":[],"reason":"file_missing","error":"Dosya bulunamadı"}
    else:
        ext=p.suffix.lower()
        if ext==".pdf": out=extract_pdf(p)
        elif ext==".udf": out=extract_udf(p)
        elif ext in {".zip",".eyp"}: out=extract_container(p)
        elif ext in {".tif",".tiff",".jpg",".jpeg",".png"}:
            out={"ok":True,"format":ext.lstrip("."),"status":"no_text","engine":"review-image-v0.1",
                 "rawText":"","references":[],"reason":"image_requires_ocr"}
        elif ext in {".txt",".html",".htm"}: out=extract_text_file(p)
        else:
            out={"ok":True,"format":ext.lstrip("."),"status":"unsupported","engine":"review-v0.1",
                 "rawText":"","references":[],"reason":"unsupported_format"}
    out["path"]=str(p)
    print(json.dumps(out,ensure_ascii=False))

if __name__=="__main__":
    main()
