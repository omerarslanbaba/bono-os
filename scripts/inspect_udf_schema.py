import sys,zipfile,json,collections,xml.etree.ElementTree as ET,os
p=sys.argv[1]
def local(tag): return tag.split('}',1)[-1]
out={"file":os.path.basename(p)}
with zipfile.ZipFile(p) as z:
    for name in ["content.xml","documentproperties.xml"]:
        if name not in z.namelist(): continue
        root=ET.fromstring(z.read(name))
        tags=collections.Counter()
        attrs=collections.Counter()
        samples={}
        for el in root.iter():
            t=local(el.tag); tags[t]+=1
            for k,v in el.attrib.items():
                kk=local(k); attrs[(t,kk)]+=1
                if kk.lower() in {"fontfamily","fontsize","bold","italic","alignment","leftindent","rightindent","spaceabove","spacebelow","firstlineindent","foreground","background"}:
                    samples.setdefault(t,{})[kk]=str(v)[:80]
        out[name]={"root":local(root.tag),"tags":tags.most_common(40),"attrs":[[a,b,n] for (a,b),n in attrs.most_common(80)],"style_attr_samples":samples}
print(json.dumps(out,ensure_ascii=False,indent=2))
