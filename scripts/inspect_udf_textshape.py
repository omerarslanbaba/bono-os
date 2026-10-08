import sys,zipfile,json,collections,xml.etree.ElementTree as ET,os
p=sys.argv[1]
with zipfile.ZipFile(p) as z:
    root=ET.fromstring(z.read("content.xml"))
def local(t):return t.split('}',1)[-1]
stats=collections.defaultdict(lambda:{"nodes":0,"text_nodes":0,"chars":0,"tails":0,"tail_chars":0})
for el in root.iter():
    t=local(el.tag);s=stats[t];s["nodes"]+=1
    if el.text:
        s["text_nodes"]+=1;s["chars"]+=len(el.text)
    if el.tail:
        s["tails"]+=1;s["tail_chars"]+=len(el.tail)
print(json.dumps(stats,ensure_ascii=False,indent=2))
