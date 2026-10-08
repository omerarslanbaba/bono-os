import re, os, json, zipfile, unicodedata, collections
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape as xesc

ALIGN={"left":0,"center":1,"right":2,"justify":3}
HEADINGS=[
 "AÇIKLAMALAR","AÇIKLAMA","HUKUKİ NEDENLER","HUKUKİ SEBEPLER","DELİLLER",
 "SONUÇ VE İSTEM","SONUÇ VE TALEP","NETİCE VE TALEP","KONU","TALEP",
 "CEVAPLARIMIZ","İTİRAZLARIMIZ","BEYANLARIMIZ","SAVUNMALARIMIZ"
]
OFFICE_MARKERS=["BONO HUKUK","YUSUF ÖMER ARSLANBABA","ÖMER ARSLANBABA"]

def norm(s):
    s=(s or "").replace("İ","I").replace("ı","i")
    s=unicodedata.normalize("NFKD",s)
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

def local(tag): return tag.split("}",1)[-1]

def read_xml(path):
    with zipfile.ZipFile(path) as z:
        if "content.xml" not in z.namelist():
            raise ValueError("content.xml bulunamadı")
        root=ET.fromstring(z.read("content.xml"))
        props=None
        if "documentproperties.xml" in z.namelist():
            try: props=ET.fromstring(z.read("documentproperties.xml"))
            except: props=None
        return root,props,z.namelist()

def span_text(para,raw):
    spans=[]
    for el in para.iter():
        if el is para: continue
        try:
            start=int(el.attrib.get("startOffset",""))
            length=int(el.attrib.get("length",""))
        except: continue
        if length>=0: spans.append((start,length))
    if not spans: return ""
    spans=sorted(set(spans))
    return "".join(raw[s:s+n] for s,n in spans if s>=0 and n>=0)

def collect_paragraphs(root,raw):
    out=[]
    elements=root.find("elements")
    if elements is None: return out
    def walk(node,loc="body"):
        tag=local(node.tag)
        here=loc
        if tag=="header": here="header"
        elif tag=="footer": here="footer"
        elif tag=="table": here="table"
        if tag=="paragraph":
            txt=span_text(node,raw).strip("\r\n")
            out.append({
                "text":txt,
                "location":here,
                "alignment":int(node.attrib.get("Alignment","0") or 0),
                "leftIndent":node.attrib.get("LeftIndent"),
                "rightIndent":node.attrib.get("RightIndent"),
                "firstLineIndent":node.attrib.get("FirstLineIndent"),
                "spaceAbove":node.attrib.get("SpaceAbove"),
                "spaceBelow":node.attrib.get("SpaceBelow")
            })
        for ch in list(node): walk(ch,here)
    walk(elements)
    return out

def classify(filename,paragraphs):
    x=norm(filename+" "+" ".join(p["text"][:120] for p in paragraphs[:12]))
    rules=[
      ("bilirkisi_raporuna_itiraz",["bilirkisi raporuna itiraz"]),
      ("bilirkisi_raporuna_beyan",["bilirkisi raporuna karsi beyan","bilirkisi raporuna beyan"]),
      ("cevap_dilekcesi",["cevap dilekcesi"]),
      ("dava_dilekcesi",["dava dilekcesi"]),
      ("istinaf",["istinaf"]),
      ("temyiz",["temyiz"]),
      ("yd_itiraz",["yd itiraz","yurutmenin durdurulmasi"]),
      ("itiraz_dilekcesi",["itiraz dilekcesi","kararina itiraz"]),
      ("beyan_dilekcesi",["beyan dilekcesi"]),
      ("savunma",["savunma dilekcesi","savunmalarimiz"]),
      ("talep_dilekcesi",["talep dilekcesi","talep evraki"]),
      ("ihtar",["ihtarname","ihtar"]),
      ("dilekce",["dilekce"]),
      ("durusma_zapti",["durusma zapti"]),
      ("gerekceli_karar",["gerekceli karar"]),
      ("iddianame",["iddianame"]),
      ("bilirkisi_raporu",["bilirkisi raporu"])
    ]
    for kind,needles in rules:
        if any(n in x for n in needles): return kind
    return "udf_belge"

def extract_sections(paragraphs):
    sections=[]; current=None
    for i,p in enumerate(paragraphs):
        txt=re.sub(r"\s+"," ",p["text"]).strip()
        if not txt: continue
        up=txt.upper().strip(" :.-")
        matched=None
        for h in HEADINGS:
            if up==h or up.startswith(h+":"):
                matched=h;break
        if matched:
            current={"heading":matched,"startParagraph":i,"items":[]}
            sections.append(current)
        elif current:
            current["items"].append(txt)
    return [{"heading":s["heading"],"startParagraph":s["startParagraph"],"text":"\n".join(s["items"])} for s in sections]

def extract_fields(filename,paragraphs,raw):
    lines=[re.sub(r"\s+"," ",p["text"]).strip() for p in paragraphs if p["text"].strip()]
    head="\n".join(lines[:35])
    courts=[x for x in lines[:25] if re.search(r"(MAHKEMESİ|DAİRESİ|MÜDÜRLÜĞÜ|SAVCILIĞI)",x.upper())]
    case_nos=list(dict.fromkeys(re.findall(r"\b20\d{2}\s*/\s*\d+(?:\s*[EK]\.?\s*)?",head,re.I)))[:8]
    dates=list(dict.fromkeys(re.findall(r"\b(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:20\d{2})\b",raw)))[:20]
    amounts=list(dict.fromkeys(re.findall(r"\b\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?\s*(?:TL|₺)\b",raw,re.I)))[:20]
    roles={}
    for role in ["DAVACI","DAVALI","SANIK","MÜŞTEKİ","ŞİKAYETÇİ","VEKİLİ","MÜDAFİİ","KATILAN"]:
        vals=[]
        for ln in lines[:50]:
            if ln.upper().startswith(role):
                vals.append(ln[:300])
        if vals: roles[role]=vals[:3]
    return {"courtCandidates":courts[:5],"caseNumbers":case_nos,"dates":dates,"amounts":amounts,"roles":roles}

def style_profile(root,paragraphs,raw):
    pf=root.find("./properties/pageFormat")
    fonts=collections.Counter();sizes=collections.Counter();aligns=collections.Counter()
    bold=italic=underline=0
    for el in root.iter():
        a=el.attrib
        if a.get("family"): fonts[a["family"]]+=1
        if a.get("size"): sizes[a["size"]]+=1
        if a.get("bold")=="true": bold+=1
        if a.get("italic")=="true": italic+=1
        if a.get("underline")=="true": underline+=1
        if local(el.tag)=="paragraph": aligns[a.get("Alignment","0")]+=1
    header="\n".join(p["text"] for p in paragraphs if p["location"]=="header" and p["text"]).strip()
    footer="\n".join(p["text"] for p in paragraphs if p["location"]=="footer" and p["text"]).strip()
    return {
      "pageFormat":dict(pf.attrib) if pf is not None else {},
      "fonts":fonts.most_common(8),"sizes":sizes.most_common(8),"alignments":aligns.most_common(),
      "boldRuns":bold,"italicRuns":italic,"underlineRuns":underline,
      "headerText":header[:4000],"footerText":footer[:4000],
      "paragraphCount":len(paragraphs),"rawTextLength":len(raw)
    }

def template_score(filename,kind,raw,sections,style):
    x=norm(filename)
    score=0.0
    if any(k in x for k in ["dilekce","beyan","savunma","itiraz","talep"]): score+=0.35
    if kind not in {"udf_belge","durusma_zapti","gerekceli_karar","iddianame","bilirkisi_raporu"}: score+=0.2
    if len(sections)>=2: score+=0.15
    upper=raw.upper()
    if any(m in upper for m in OFFICE_MARKERS): score+=0.25
    if style.get("headerText"): score+=0.05
    return min(1.0,round(score,3))

def chunks(paragraphs,max_chars=1800):
    result=[];buf=[];n=0;heading=None
    for p in paragraphs:
        txt=re.sub(r"\s+"," ",p["text"]).strip()
        if not txt: continue
        up=txt.upper().strip(" :.-")
        if any(up==h or up.startswith(h+":") for h in HEADINGS): heading=up[:160]
        if n+len(txt)>max_chars and buf:
            result.append({"heading":heading,"text":"\n".join(buf)})
            buf=[];n=0
        buf.append(txt);n+=len(txt)+1
    if buf: result.append({"heading":heading,"text":"\n".join(buf)})
    return result

def analyze(path):
    root,props,names=read_xml(path)
    raw=(root.find("content").text or "") if root.find("content") is not None else ""
    paragraphs=collect_paragraphs(root,raw)
    kind=classify(os.path.basename(path),paragraphs)
    sections=extract_sections(paragraphs)
    style=style_profile(root,paragraphs,raw)
    fields=extract_fields(os.path.basename(path),paragraphs,raw)
    score=template_score(os.path.basename(path),kind,raw,sections,style)
    return {
      "fileName":os.path.basename(path),"kind":kind,"rawText":raw,
      "paragraphs":paragraphs,"sections":sections,"fields":fields,
      "styleProfile":style,"templateScore":score,"chunks":chunks(paragraphs),
      "hasSignature":"sign.sgn" in names,"entries":names
    }

def inline_runs(text):
    tokens=[];pos=0
    pat=re.compile(r"(\*\*\*.+?\*\*\*|\*\*.+?\*\*|__.+?__|\*[^*]+?\*)")
    for m in pat.finditer(text):
        if m.start()>pos: tokens.append({"text":text[pos:m.start()]})
        s=m.group(0); item={"text":s}
        if s.startswith("***") and s.endswith("***"): item={"text":s[3:-3],"bold":True,"italic":True}
        elif s.startswith("**") and s.endswith("**"): item={"text":s[2:-2],"bold":True}
        elif s.startswith("__") and s.endswith("__"): item={"text":s[2:-2],"underline":True}
        elif s.startswith("*") and s.endswith("*"): item={"text":s[1:-1],"italic":True}
        tokens.append(item);pos=m.end()
    if pos<len(text): tokens.append({"text":text[pos:]})
    return tokens or [{"text":""}]

def markdown_paragraphs(md):
    out=[]
    for line in (md or "").replace("\r\n","\n").split("\n"):
        align="justify";indent=None
        if line.startswith("|"): align="center";line=line[1:].lstrip()
        elif line.startswith(">>>"): align="justify";indent=27.777779;line=line[3:].lstrip();runs=inline_runs(line);[r.update({"italic":True}) for r in runs];out.append({"alignment":align,"left_indent":indent,"runs":runs});continue
        elif line.startswith(":::"): align="left";indent=55.0;line=line[3:].lstrip()
        out.append({"alignment":align,"left_indent":indent,"runs":inline_runs(line)})
    return out

def build_udf(md,output_path,style=None):
    style=style or {}
    paras=markdown_paragraphs(md)
    raw_parts=[];cursor=0
    font=(style.get("fonts") or [["Times New Roman",1]])[0][0] or "Times New Roman"
    size=str((style.get("sizes") or [["12",1]])[0][0] or "12")

    def emit_runs(runs,alignment="justify",left_indent=None,location="body"):
        nonlocal cursor
        runs=[dict(r) for r in runs] or [{"text":""}]
        line="".join(r.get("text","") for r in runs)
        if not line.endswith("\n"):
            runs[-1]["text"]=runs[-1].get("text","")+"\n"
        inner=[]
        for r in runs:
            txt=r.get("text","");ln=len(txt)
            attrs=[f'family="{xesc(font)}"',f'size="{xesc(size)}"']
            if r.get("bold"): attrs.append('bold="true"')
            if r.get("italic"): attrs.append('italic="true"')
            if r.get("underline"): attrs.append('underline="true"')
            attrs.extend([f'startOffset="{cursor}"',f'length="{ln}"'])
            inner.append("<content "+" ".join(attrs)+" />")
            raw_parts.append(txt);cursor+=ln
        pa=[f'Alignment="{ALIGN.get(alignment,3)}"',f'family="{xesc(font)}"',f'size="{xesc(size)}"']
        if left_indent is not None: pa.append(f'LeftIndent="{left_indent}"')
        paragraph="<paragraph "+" ".join(pa)+">"+"".join(inner)+"</paragraph>"
        return paragraph

    body_xml=[emit_runs(p["runs"],p["alignment"],p.get("left_indent")) for p in paras]
    header_xml=[]
    footer_xml=[]
    header_text=(style.get("headerText") or "").strip()
    footer_text=(style.get("footerText") or "").strip()
    if header_text:
        header_xml=[emit_runs(inline_runs(line),"center",None,"header") for line in header_text.splitlines() if line.strip()]
    if footer_text:
        footer_xml=[emit_runs(inline_runs(line),"center",None,"footer") for line in footer_text.splitlines() if line.strip()]

    raw="".join(raw_parts)
    pf=style.get("pageFormat") or {
      "mediaSizeName":"1","leftMargin":"42.51968479156494","rightMargin":"42.51968479156494",
      "topMargin":"42.51968479156494","bottomMargin":"42.51968479156494",
      "paperOrientation":"1","headerFOffset":"20.0","footerFOffset":"20.0"
    }
    pf_xml="<pageFormat "+" ".join(f'{k}="{xesc(str(v))}"' for k,v in pf.items())+" />"
    styles=f'<style name="default" family="{xesc(font)}" description="Geçerli" size="{xesc(size)}" bold="false" italic="false" /><style name="hvl-default" family="{xesc(font)}" size="{xesc(size)}" description="Gövde" />'
    elements=[]
    if header_xml: elements.append('<header startPage="1">'+"".join(header_xml)+"</header>")
    elements.extend(body_xml)
    if footer_xml: elements.append("<footer>"+"".join(footer_xml)+"</footer>")
    cdata=raw.replace("]]>","]]]]><![CDATA[>")
    xml='<?xml version="1.0" encoding="UTF-8" ?>\n<template format_id="1.8"><content><![CDATA['+cdata+']]></content><properties>'+pf_xml+'</properties><elements resolver="hvl-default">'+"".join(elements)+'</elements><styles>'+styles+'</styles></template>'
    output_path=Path(output_path);output_path.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output_path,"w",zipfile.ZIP_DEFLATED) as z:
        z.writestr("content.xml",xml.encode("utf-8"))
        z.writestr("documentproperties.xml",'<?xml version="1.0" encoding="UTF-8"?><properties/>'.encode("utf-8"))
    return {"path":str(output_path),"paragraphCount":len(paras)+len(header_xml)+len(footer_xml),"size":output_path.stat().st_size,"signed":False,"styleApplied":{"font":font,"size":size,"header":bool(header_xml),"footer":bool(footer_xml)}}

if __name__=="__main__":
    import argparse
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest="cmd",required=True)
    a=sub.add_parser("analyze");a.add_argument("path")
    b=sub.add_parser("build");b.add_argument("input_json");b.add_argument("output")
    v=sub.add_parser("validate");v.add_argument("path")
    ns=ap.parse_args()
    if ns.cmd=="analyze":
        print(json.dumps(analyze(ns.path),ensure_ascii=False))
    elif ns.cmd=="validate":
        a=analyze(ns.path)
        print(json.dumps({"ok":True,"fileName":a["fileName"],"kind":a["kind"],"paragraphCount":a["styleProfile"].get("paragraphCount",0),"rawTextLength":a["styleProfile"].get("rawTextLength",0),"hasSignature":a["hasSignature"]},ensure_ascii=False))
    else:
        data=json.loads(Path(ns.input_json).read_text(encoding="utf-8"))
        print(json.dumps(build_udf(data.get("markdown",""),ns.output,data.get("styleProfile")),ensure_ascii=False))
