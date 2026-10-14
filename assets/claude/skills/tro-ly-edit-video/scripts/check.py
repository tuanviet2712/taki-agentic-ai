# -*- coding: utf-8 -*-
"""Kiểm tra 3 lượt cho mỗi video: đồng bộ · hình · tiếng."""
import subprocess, os, sys, json, wave, struct, math
def sh(c): return subprocess.run(c,capture_output=True,text=True)
def probe(p,*e):
    return sh(["ffprobe","-v","error","-show_entries",",".join(e),"-of","default=nw=1",p]).stdout
def val(p,ent,sel=None):
    c=["ffprobe","-v","error"]+ (["-select_streams",sel] if sel else [])+["-show_entries",ent,"-of","csv=p=0",p]
    return sh(c).stdout.strip().splitlines()

def lot1_dongbo(out, expect, cards):
    """lượt 1 — độ dài hình phải bằng độ dài tiếng và bằng dự kiến"""
    e=[]
    dv=float(val(out,"stream=duration","v:0")[0]) if val(out,"stream=duration","v:0") else 0
    da=float(val(out,"stream=duration","a:0")[0]) if val(out,"stream=duration","a:0") else 0
    df=float(val(out,"format=duration")[0])
    nf=int(val(out,"stream=nb_frames","v:0")[0])
    if abs(dv-da)>0.30: e.append(f"hình {dv:.2f}s lệch tiếng {da:.2f}s")
    if abs(df-expect)>0.40: e.append(f"độ dài {df:.2f}s khác dự kiến {expect:.2f}s")
    if abs(nf-round(df*30))>2: e.append(f"{nf} khung ≠ {round(df*30)} khung của {df:.2f}s")
    return e, f"hình {dv:.2f}s · tiếng {da:.2f}s · {nf} khung"

def lot2_hinh(out, cards):
    """lượt 2 — không đứng hình ngoài card, không khung đen, đúng khổ"""
    e=[]
    wh=val(out,"stream=width,height","v:0")
    wh=[x for x in ",".join(wh).split(",") if x.strip().isdigit()]
    w,h=(wh+["?","?"])[:2]
    if (w,h)!=("1080","1920"): e.append(f"khổ {w}x{h} không phải 1080x1920")
    fps=val(out,"stream=r_frame_rate","v:0")[0]
    if fps not in ("30/1","30000/1001"): e.append(f"nhịp khung {fps}")
    o=sh(["ffmpeg","-hide_banner","-nostats","-i",out,"-vf","freezedetect=n=-58dB:d=0.9","-map","0:v","-f","null","-"]).stderr
    fr=[]
    for ln in o.splitlines():
        if "freeze_start" in ln: fr.append(float(ln.split(":")[-1]))
    lo=[t for t in fr if not any(a-0.6<=t<=b+0.3 for a,b in cards)]
    if lo: e.append(f"đứng hình ngoài card tại {['%.1f'%x for x in lo[:5]]}")
    o2=sh(["ffmpeg","-hide_banner","-nostats","-i",out,"-vf","blackdetect=d=0.4:pix_th=0.06","-map","0:v","-f","null","-"]).stderr
    bl=[l for l in o2.splitlines() if "black_start" in l]
    if bl: e.append(f"{len(bl)} đoạn khung đen")
    return e, f"{len(fr)} đoạn tĩnh (đều là card) · {w}x{h} · {fps}"

def lot3_tieng(out, voice):
    """lượt 3 — âm lượng đúng chuẩn, không còn khoảng lặng dài, không vỡ tiếng"""
    e=[]
    o=sh(["ffmpeg","-hide_banner","-nostats","-i",out,"-af","ebur128=peak=true","-f","null","-"]).stderr
    I=TP=None
    for ln in o.splitlines():
        s=ln.strip()
        if s.startswith("I:") and "LUFS" in s: I=float(s.split()[1])
        if s.startswith("Peak:"): TP=float(s.split()[1])
    if I is None: e.append("không đo được âm lượng")
    else:
        if not(-17.0<=I<=-14.0): e.append(f"âm lượng {I} LUFS ngoài khoảng -17..-14")
    if TP is not None and TP>-1.0: e.append(f"đỉnh {TP} dBFS quá cao")
    sh(["ffmpeg","-v","error","-y","-i",voice,"-ac","1","-ar","16000","/tmp/_chk16.wav"])
    wf=wave.open("/tmp/_chk16.wav"); n=wf.getnframes(); sr=wf.getframerate()
    s=struct.unpack(f"<{n}h",wf.readframes(n)); FR=int(sr*0.02); env=[]
    for i in range(0,n-FR,FR):
        acc=0
        for k in range(i,i+FR,4): acc+=s[k]*s[k]
        env.append(20*math.log10(math.sqrt(acc/(FR/4))/32768+1e-9))
    srt=sorted(env); thr=srt[int(len(srt)*0.10)]+max(6.0,(srt[int(len(srt)*0.85)]-srt[int(len(srt)*0.10)])*0.28)
    runs=[];i=0
    while i<len(env):
        if env[i]<thr:
            j=i
            while j<len(env) and env[j]<thr: j+=1
            if (j-i)*0.02>0.75 and j<len(env)-8: runs.append(round(i*0.02,1))
            i=j
        else: i+=1
    if runs: e.append(f"còn khoảng lặng dài tại {runs[:5]}")
    return e, f"{I} LUFS · đỉnh {TP} dBFS · {len(runs)} khoảng lặng >0.75s"

def check(name,out,expect,cards,voice):
    print(f"\n=== {name} ===")
    allok=True
    for i,(fn,args) in enumerate([(lot1_dongbo,(out,expect,cards)),(lot2_hinh,(out,cards)),(lot3_tieng,(out,voice))],1):
        err,info=fn(*args)
        tag="ĐẠT" if not err else "LỖI"
        print(f"  lượt {i} — {['đồng bộ','hình','tiếng'][i-1]:<8} {tag}   {info}")
        for x in err: print(f"           ! {x}")
        if err: allok=False
    return allok
