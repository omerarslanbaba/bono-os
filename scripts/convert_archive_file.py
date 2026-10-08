import sys, json, subprocess, os
from pathlib import Path

src=Path(sys.argv[1]).resolve()
out=Path(sys.argv[2]).resolve()
out.parent.mkdir(parents=True,exist_ok=True)
ext=src.suffix.lower()
res={"source":str(src),"output":str(out),"ok":False,"error":None}

try:
    if ext in {".tif",".tiff",".jpg",".jpeg",".png"}:
        from PIL import Image, ImageSequence
        im=Image.open(src)
        frames=[]
        for frame in ImageSequence.Iterator(im):
            f=frame.convert("RGB")
            frames.append(f.copy())
        if not frames:
            raise ValueError("Görüntü karesi bulunamadı")
        frames[0].save(out,"PDF",save_all=True,append_images=frames[1:])
    elif ext in {".html",".htm"}:
        chrome=Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        edge=Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
        exe=chrome if chrome.exists() else edge
        if not exe.exists():
            raise RuntimeError("Chrome/Edge bulunamadı")
        import shutil, uuid
        staging=Path(__file__).resolve().parents[1]/"data"/"staging"
        staging.mkdir(parents=True,exist_ok=True)
        profile=staging/("chrome-pdf-"+uuid.uuid4().hex)
        profile.mkdir(parents=True,exist_ok=True)
        try:
            def psq(value):
                return "'" + str(value).replace("'","''") + "'"
            ps_cmd=f"& {psq(exe)} --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir={psq(profile)} --print-to-pdf={psq(out)} {psq(src.as_uri())}; Start-Sleep -Milliseconds 1500"
            cp=subprocess.run(["powershell.exe","-NoProfile","-Command",ps_cmd],capture_output=True,text=True,timeout=90)
            import time
            for _ in range(60):
                if out.exists() and out.stat().st_size>0:
                    break
                time.sleep(0.1)
            if cp.returncode!=0 or not out.exists() or out.stat().st_size==0:
                raise RuntimeError((cp.stderr or cp.stdout or "HTML PDF dönüşümü başarısız")[-1000:])
        finally:
            shutil.rmtree(profile,ignore_errors=True)
    elif ext in {".xls",".xlsx",".xlsm"}:
        import win32com.client
        excel=win32com.client.DispatchEx("Excel.Application")
        excel.Visible=False
        excel.DisplayAlerts=False
        wb=None
        try:
            wb=excel.Workbooks.Open(str(src),ReadOnly=True)
            wb.ExportAsFixedFormat(0,str(out))
        finally:
            if wb is not None:
                wb.Close(False)
            excel.Quit()
    else:
        raise ValueError("Desteklenmeyen dönüşüm formatı: "+ext)
    if not out.exists() or out.stat().st_size==0:
        raise RuntimeError("PDF üretilemedi")
    res["ok"]=True
except Exception as e:
    res["error"]=str(e)
print(json.dumps(res,ensure_ascii=True))
