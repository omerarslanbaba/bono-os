import sys, zipfile, json, os
p=sys.argv[1]
out={"file":os.path.basename(p),"is_zip":zipfile.is_zipfile(p)}
if out["is_zip"]:
    with zipfile.ZipFile(p) as z:
        out["entries"]=z.namelist()[:100]
        out["count"]=len(z.namelist())
print(json.dumps(out,ensure_ascii=False,indent=2))
