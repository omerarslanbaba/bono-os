import sqlite3, json, re, unicodedata, shutil
from pathlib import Path
from datetime import datetime

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/"data"/"bono.db"
BACKUP=ROOT/"data"/"backups"
IMPORTS=ROOT/"data"/"imports"
BACKUP.mkdir(parents=True,exist_ok=True); IMPORTS.mkdir(parents=True,exist_ok=True)

ROWS=[
{"file_no":"F-1","hearing":"23.09.2025","court":"Kocaeli 2. Asliye Ceza","case_no":"2024/477 E.","case_type":"Ceza","client":"Mehmet Özkaraman","opponent":"İlhanalp Şamlı","subject":"BTM Taksirle Yaralama","last_status":"Müşteki zorla getirme kararı","next_action":"Müşteki aranacak","notes":""},
{"file_no":"F-2","hearing":"","court":"Gölcük CBS","case_no":"","case_type":"Ceza","client":"Azra Mina ŞERİT","opponent":"Deniz EROĞLU","subject":"Hakaret","last_status":"Bekleniyor","next_action":"Öner yetki atacak vekil kaydı yapılacak","notes":""},
{"file_no":"F-3","hearing":"","court":"Gölcük CBS","case_no":"","case_type":"Ceza","client":"Azra Mina ŞERİT","opponent":"Edanur KESKİN","subject":"Tehdit, Hakaret","last_status":"Bekleniyor","next_action":"Öner yetki atacak vekil kaydı yapılacak","notes":""},
{"file_no":"F-4","hearing":"15.05.2025","court":"Kocaeli 7. Asliye Ceza","case_no":"2024/571 E.","case_type":"Ceza (Uyuşturucu)","client":"Hakan ZORLU","opponent":"Kamu","subject":"Denetimli Serbestlik İhlali","last_status":"Kimya İhtisas Dairesinden görüş bekleniyor.","next_action":"ATK raporu geldiğinde beyanda bulunulacak","notes":"Nervium reçeteli kullanım savunuldu."},
{"file_no":"F-5","hearing":"Basit Yargılama","court":"Kocaeli 12. Asliye Ceza","case_no":"2024/359 E.","case_type":"Ceza","client":"İsmail ŞEKERSOY","opponent":"Kamil DÖNERKAYA","subject":"Mala zarar verme, tehdit","last_status":"Müşteki Şikayetten Vazgeçme yapacak","next_action":"Dilekçesi hazırlanıp müştekiye verilecek","notes":""},
{"file_no":"F-6","hearing":"","court":"Kocaeli 1. Asliye Ceza","case_no":"2024/820 E.","case_type":"Ceza","client":"İsmail ŞEKERSOY","opponent":"Recep EŞDOĞAN","subject":"Tehdit, Hakaret","last_status":"KARARA ÇIKTI İTİRAZ EDİLECEK 25.04 SON","next_action":"KARARA İTİRAZ EDİLİP MÜŞTEKİ ŞİKAYETTEN VAZGEÇECEK","notes":""},
{"file_no":"F-7","hearing":"","court":"Bakırköy 6. Asliye Ceza","case_no":"2025/210 E.","case_type":"Ceza","client":"Hamza Çakıcı","opponent":"Nisanur DURMAZ","subject":"Tehdit ve Hakaret","last_status":"Savunma Dilekçesi sunulmadı.","next_action":"Vekillikten çekilebiliriz.","notes":""},
{"file_no":"F-8","hearing":"","court":"Kocaeli CBS","case_no":"2025/","case_type":"Ceza","client":"Mahsun Öztürk","opponent":"Serdar ARSLAN","subject":"Kasten Öldürme","last_status":"Pusulalar sunuldu tutukluluk gözden geçirmesi bekleniyor","next_action":"Yüzyüze görüşme","notes":""},
{"file_no":"F-9","hearing":"24.04.2025","court":"Kocaeli 9. Asliye Ceza","case_no":"2024/861","case_type":"Ceza","client":"Hakan Zorlu","opponent":"Mehmet Ali Kuzu","subject":"Kişiyi Hürriyetten yoksun bırakma","last_status":"BERAAT","next_action":"BERAAT","notes":""},
{"file_no":"F-10","hearing":"09.10.2025","court":"Ankara Batı 2. Ağır Ceza","case_no":"2025/236 E.","case_type":"Ceza","client":"Hüseyin Erdem YILMAZ","opponent":"Kamu","subject":"TCK 188/3 – Uyuşturucu Ticareti","last_status":"Tensip tamamlandı, SEGBİS talimatı verildi","next_action":"SEGBİS duruşması – savunma ve tanık ifadesi","notes":"Enes’in ifadesi geri çekildi, delil yok, HTS/BTK aleyhte değil, beraat talebi yönünde savunma hazırlanacak"},
{"file_no":"F-11","hearing":"(Belirlenecek Tensip Tarihi)","court":"Kocaeli 1. İş Mahkemesi","case_no":"2025/146","case_type":"Hukuk","client":"Özkan GÜNDÜZ","opponent":"Fatma YILDIRIM - SGK","subject":"SGK Hizmet Tespit","last_status":"Dava Açıldı, Tensip ve Tebligatlar Bekleniyor","next_action":"Tensip sonrası tanık listesi sunulacak, delil talepleri yazılacak","notes":"EYT amacıyla açıldı, eksik bildirim nedeniyle hak düşürücü süre uygulanmaz savunusu yapılacak."},
{"file_no":"F-12","hearing":"18..11.2025","court":"Kocaeli 7. Asliye Ceza","case_no":"2024/642","case_type":"Ceza","client":"Samet Durudeniz","opponent":"Kamu","subject":"7258 Sayılı Kanuna Muhalefet (Yasa Dışı Bahis)","last_status":"bir sonraki duruşma bekleniyor","next_action":"","notes":""}
]

def norm(s):
    s=(s or "").replace("İ","I").replace("ı","i")
    s=unicodedata.normalize("NFKD",s)
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
shutil.copy2(DB,BACKUP/f"bono_before_derdestler_{stamp}.db")
(IMPORTS/f"DERDESTLER_EXCEL_Sayfa1_{stamp}.json").write_text(json.dumps(ROWS,ensure_ascii=False,indent=2),encoding="utf-8")

con=sqlite3.connect(DB,timeout=30); con.row_factory=sqlite3.Row
con.execute("PRAGMA foreign_keys=ON"); con.execute("PRAGMA busy_timeout=30000")
con.execute("""CREATE TABLE IF NOT EXISTS office_file_import_sources(
 id INTEGER PRIMARY KEY, office_file_id INTEGER NOT NULL, source_type TEXT NOT NULL, source_name TEXT NOT NULL,
 source_ref TEXT, source_row INTEGER, imported_at TEXT NOT NULL DEFAULT (datetime('now')), payload_json TEXT,
 UNIQUE(office_file_id,source_type,source_name,source_row),
 FOREIGN KEY(office_file_id) REFERENCES office_files(id) ON DELETE CASCADE
)""")

clients=con.execute("SELECT id,display_name FROM clients").fetchall()
by_norm={norm(r["display_name"]):r for r in clients}
created_clients=[]; linked_clients=[]; imported=[]

con.execute("BEGIN")
try:
  for idx,row in enumerate(ROWS,start=2):
    key=norm(row["client"]); client=by_norm.get(key)
    if client:
      client_id=client["id"]; linked_clients.append(row["client"])
    else:
      cr=con.execute("""INSERT INTO clients(display_name,client_type,notes) VALUES(?,?,?)""",
        (row["client"],"person","Geçici kayıt · DERDESTLER EXCEL aktarımından oluşturuldu; UYAP/vekâlet ile doğrulanacak."))
      client_id=cr.lastrowid
      client={"id":client_id,"display_name":row["client"]}; by_norm[key]=client; created_clients.append(row["client"])

    existing=con.execute("SELECT id FROM office_files WHERE file_no=?",(row["file_no"],)).fetchone()
    title=f'{row["client"]} · {row["subject"]}' if row["subject"] else row["client"]
    note_parts=[
      "Kaynak: DERDESTLER EXCEL / Sayfa1 (eski takip kaydı; güncellik doğrulanacak).",
      f'Eski sonraki duruşma: {row["hearing"]}' if row["hearing"] else None,
      f'Eski son durum: {row["last_status"]}' if row["last_status"] else None,
      f'Eski sonraki işlem: {row["next_action"]}' if row["next_action"] else None,
      f'Eski not: {row["notes"]}' if row["notes"] else None
    ]
    notes="\n".join(x for x in note_parts if x)
    if existing:
      office_id=existing["id"]
      con.execute("""UPDATE office_files SET title=?,status='needs_verification',primary_client_id=?,notes=?,updated_at=datetime('now') WHERE id=?""",
        (title,client_id,notes,office_id))
    else:
      rr=con.execute("""INSERT INTO office_files(file_no,title,status,primary_client_id,notes) VALUES(?,?,?,?,?)""",
        (row["file_no"],title,"needs_verification",client_id,notes))
      office_id=rr.lastrowid

    ext=f'legacy:DERDESTLER:{row["file_no"]}'
    case=con.execute("SELECT id FROM cases WHERE external_id=?",(ext,)).fetchone()
    if case:
      case_id=case["id"]
      con.execute("""UPDATE cases SET office_file_id=?,office_file_no=?,court=?,court_file_no=?,case_type=?,status='needs_verification',client_name=? WHERE id=?""",
        (office_id,row["file_no"],row["court"],row["case_no"],row["case_type"],row["client"],case_id))
    else:
      rr=con.execute("""INSERT INTO cases(external_id,office_file_no,court,court_file_no,case_type,status,client_name,office_file_id)
        VALUES(?,?,?,?,?,'needs_verification',?,?)""",
        (ext,row["file_no"],row["court"],row["case_no"],row["case_type"],row["client"],office_id))
      case_id=rr.lastrowid

    con.execute("DELETE FROM parties WHERE case_id=? AND external_id LIKE 'legacy:DERDESTLER:%'",(case_id,))
    con.execute("""INSERT INTO parties(case_id,external_id,name,role,is_client,client_id) VALUES(?,?,?,?,1,?)""",
      (case_id,f'legacy:DERDESTLER:{row["file_no"]}:client',row["client"],"Müvekkil",client_id))
    if row["opponent"]:
      con.execute("""INSERT INTO parties(case_id,external_id,name,role,is_client,client_id) VALUES(?,?,?,?,0,NULL)""",
        (case_id,f'legacy:DERDESTLER:{row["file_no"]}:opponent',row["opponent"],"Karşı Taraf"))

    con.execute("""INSERT INTO office_file_import_sources(office_file_id,source_type,source_name,source_ref,source_row,payload_json)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(office_file_id,source_type,source_name,source_row) DO UPDATE SET payload_json=excluded.payload_json,imported_at=datetime('now')""",
      (office_id,"google_sheet","DERDESTLER EXCEL","1YgOeK0uUteG25vfVEHJsB4p_VCfXrUlkHtcZ4J-DlQc",idx,json.dumps(row,ensure_ascii=False)))
    imported.append({"file_no":row["file_no"],"office_file_id":office_id,"case_id":case_id,"client_id":client_id})

  con.execute("""INSERT INTO audit_log(occurred_at,actor,action,entity_type,entity_id,detail_json)
    VALUES(datetime('now'),'system','import_derdestler_excel','batch',NULL,?)""",
    (json.dumps({"source":"DERDESTLER EXCEL / Sayfa1","rows":len(ROWS),"created_clients":created_clients},ensure_ascii=False),))
  con.commit()
except:
  con.rollback(); raise

print(json.dumps({
 "ok":True,"imported":len(imported),"office_files":con.execute("SELECT COUNT(*) FROM office_files").fetchone()[0],
 "cases":con.execute("SELECT COUNT(*) FROM cases WHERE external_id LIKE 'legacy:DERDESTLER:%'").fetchone()[0],
 "created_clients":created_clients,"linked_existing_count":len(linked_clients),"backup":str(BACKUP/f"bono_before_derdestler_{stamp}.db"),
 "source_snapshot":str(IMPORTS/f"DERDESTLER_EXCEL_Sayfa1_{stamp}.json")
},ensure_ascii=False))
con.close()
