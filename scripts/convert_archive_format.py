import sys, os, json, subprocess
from pathlib import Path

src=Path(sys.argv[1]).resolve()
out=Path(sys.argv[2]).resolve()
out.parent.mkdir(parents=True,exist_ok=True)
ext=src.suffix.lower()
result={"source":str(src),"output":str(out),"ok":False,"type":ext,"error":None}
try:
    if out.exists() and out.stat().st_size>0:
        result["ok"]=True
        result["existing"]=True
    elif ext in (".tif",".tiff"):
        from PIL import Image, ImageSequence
        with Image.open(src) as im:
            frames=[f.convert("RGB") for f in ImageSequence.Iterator(im)]
            if not frames: raise ValueError("TIFF sayfası bulunamadı")
            frames[0].save(out,"PDF",save_all=True,append_images=frames[1:],resolution=150.0)
        result["ok"]=out.exists() and out.stat().st_size>0
    elif ext in (".html",".htm"):
        edge=Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
        if not edge.exists(): raise FileNotFoundError("Microsoft Edge bulunamadı")
        url=src.as_uri()
        cp=subprocess.run([str(edge),"--headless","--disable-gpu","--no-pdf-header-footer",f"--print-to-pdf={out}",url],
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
        if cp.returncode!=0 or not out.exists():
            raise RuntimeError((cp.stderr or cp.stdout).decode("utf-8","ignore")[-1000:])
        result["ok"]=True
    elif ext in (".xls",".xlsx"):
        import win32com.client
        excel=win32com.client.DispatchEx("Excel.Application")
        excel.Visible=False
        excel.DisplayAlerts=False
        wb=None
        try:
            wb=excel.Workbooks.Open(str(src),ReadOnly=True)
            wb.ExportAsFixedFormat(0,str(out))
        finally:
            if wb is not None: wb.Close(False)
            excel.Quit()
        result["ok"]=out.exists() and out.stat().st_size>0
    else:
        raise ValueError("Desteklenmeyen dönüşüm formatı: "+ext)
except Exception as e:
    result["error"]=str(e)
print(json.dumps(result,ensure_ascii=False))
