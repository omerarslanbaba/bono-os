import sys,zipfile,json,xml.etree.ElementTree as ET,os
p=sys.argv[1]
with zipfile.ZipFile(p) as z: root=ET.fromstring(z.read("content.xml"))
def local(t): return t.split('}',1)[-1]
raw=root.find("content")
out={"root_attrs":root.attrib,"properties":[],"elements":[],"styles":[]}
props=root.find("properties")
if props is not None:
    for el in list(props): out["properties"].append({"tag":local(el.tag),"attrs":el.attrib})
els=root.find("elements")
if els is not None:
    for el in list(els)[:12]:
        item={"tag":local(el.tag),"attrs":el.attrib,"children":[]}
        for ch in list(el)[:8]:
            item["children"].append({"tag":local(ch.tag),"attrs":ch.attrib,"text_len":len(ch.text or "")})
        out["elements"].append(item)
styles=root.find("styles")
if styles is not None:
    for el in list(styles)[:12]: out["styles"].append({"tag":local(el.tag),"attrs":el.attrib})
out["raw_text_len"]=len(raw.text or "") if raw is not None else 0
print(json.dumps(out,ensure_ascii=False,indent=2))
