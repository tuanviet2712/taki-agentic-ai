# -*- coding: utf-8 -*-
"""Dựng video theo cấu hình. Hai kiểu: 'screen' (quay màn hình, không che) và 'talk' (nói trực tiếp)."""
import os, sys, math, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, config, che_do
from plan import Plan

A = kit.kho(); F=f"{A}/fonts"; C=f"{A}/cards"
HERE=os.path.dirname(os.path.abspath(__file__))
CW,CH=1080,1920
def run(c):
    if subprocess.run(c).returncode: sys.exit("ffmpeg lỗi: "+" ".join(c[:6]))
def esc(t): return t.replace(":","\\:").replace("'","\u2019")
def dt(f,t,s,col,x,y): return f"drawtext=fontfile='{F}/{f}':text='{esc(t)}':fontsize={s}:fontcolor={col}:x={x}:y={y}:expansion=none"
def box(x,y,w,h,c,a=1): return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={c}@{a}:t=fill"
YEL="0xf0ff00"; INK="0x101208"; RED="0xff5a4a"

_M={}
def measure(font,text,size):
    k=(font,text,size)
    if k in _M: return _M[k]
    p="/tmp/_vm.png"; hh=int(size*2.3)
    run(["ffmpeg","-v","error","-y","-f","lavfi","-i",f"color=c=black:s=2600x{hh}",
         "-vf",dt(font,text,size,"white","40","20"),"-frames:v","1",p])
    raw=subprocess.run(["ffmpeg","-v","error","-i",p,"-pix_fmt","gray","-f","rawvideo","-"],capture_output=True).stdout
    xs=[x for x in range(2600) if any(raw[y*2600+x]>40 for y in range(0,hh,3))]
    ys=[y for y in range(hh) if any(raw[y*2600+x]>40 for x in range(0,2600,3))]
    _M[k]=(xs[-1]-xs[0]+1, ys[-1]-ys[0]+1, xs[0]-40, ys[0]-20) if xs and ys else (0,0,0,0)
    return _M[k]
def fitsize(font,text,tw,cap):
    s=cap
    while s>18 and measure(font,text,s)[0]>tw: s-=6
    return s

def knock(out,font,big,small,bs=300,ss=88,gap=15):
    bs=fitsize(font,big,900,bs); ss=fitsize(font,small,int(measure(font,big,bs)[0]*0.72),ss)   # chữ nhỏ phải hẹp hơn hẳn chữ lớn
    bw,bh,bx,byo=measure(font,big,bs); sw,sh,sx,syo=measure(font,small,ss)
    h=int(bs*1.6); by=40; sy=int(by+byo+bh*0.5-(syo+sh*0.5))
    fc=[f"[0]{dt(font,big,bs,YEL,'(w-text_w)/2',by)}[big]",
        f"[1]{dt(font,small,ss,'white','(w-text_w)/2',sy)}:borderw={gap}:bordercolor=white,format=gray[mk]",
        "[big]split[b1][b2]","[b2]alphaextract[ba]","[ba][mk]blend=all_mode=subtract[na]","[b1][na]alphamerge[ko]",
        f"[0]{dt(font,small,ss,'white','(w-text_w)/2',sy)}[sm]","[ko][sm]overlay=0:0"]
    run(["ffmpeg","-v","error","-y","-f","lavfi","-i",f"color=c=black@0:s={CW}x{h},format=rgba",
         "-f","lavfi","-i",f"color=c=black:s={CW}x{h}","-filter_complex",";".join(fc),"-frames:v","1",out])
    return h

def card(out,font,grid,kicker,title,art=None):
    """card toàn khung cho video nói trực tiếp"""
    th=knock("/tmp/_ck.png",font,kicker,title,300,88)
    ins=["-ss","3","-t","1","-i",f"{A}/{grid}","-i","/tmp/_ck.png"]
    fc=[f"[0:v]scale={CW}:{CH},setsar=1[bg]",f"[bg][1]overlay=0:{int(CH*0.30)}[v]"]
    run(["ffmpeg","-v","error","-y"]+ins+["-filter_complex",";".join(fc),"-map","[v]","-frames:v","1",out])

def lufs(p):
    o=subprocess.run(["ffmpeg","-hide_banner","-nostats","-i",p,"-af","ebur128","-f","null","-"],
                     capture_output=True,text=True).stderr
    v=[l for l in o.splitlines() if l.strip().startswith("I:")]
    return float(v[-1].split()[1]) if v else -70.0
_G={}
def gain(p,target,cap=6.0):
    if p not in _G: _G[p]=lufs(p)
    g=10**((target-_G[p])/20)
    return None if g>cap else round(g,4)

def build(cfg):
    vid=cfg["id"]; font=cfg.get("font") or kit.ten_font("title_to")
    PD=kit.ten_ass("phu_de")                       # tên font phụ đề cho ASS, lấy từ cau-hinh.json
    SRC=f"{A}/SRC_{vid}.mp4"
    OUTDIR=os.path.expanduser(f"~/Downloads/{cfg['folder']}"); os.makedirs(OUTDIR,exist_ok=True)
    TMP=f"{A}/_{vid}"; os.makedirs(TMP,exist_ok=True)
    P=Plan(f"{HERE}/{vid}_16k.wav", f"{HERE}/{vid}.json", hard_remove=cfg.get("hard_remove",()))
    print(f"  {vid}: {P.report()}")
    T=P.TOTAL

    # --- ảnh tiêu đề / card ---
    graf=[]
    hk=cfg["hook"]
    h_hook=knock(f"{TMP}/t_hook.png",font,hk[0],hk[1])
    graf.append((f"{TMP}/t_hook.png", P.t_of(P.anchor(cfg["hook_at"][0])), P.t_of(P.anchor(cfg["hook_at"][1])), cfg.get("hook_y",300)))
    for i,(kick,title,at) in enumerate(cfg.get("sections",[])):
        p=f"{TMP}/t{i}.png"; knock(p,font,kick,title,260,80)
        a=P.anchor(at); graf.append((p,P.t_of(a),P.t_of(a)+2.0,cfg.get("sec_y",170)))
    covers=[]
    for i,(grid,kick,title,a,b) in enumerate(cfg.get("cards",[])):
        p=f"{TMP}/c{i}.png"; card(p,font,grid,kick,title)
        covers.append((p,P.t_of(P.anchor(a)),P.t_of(P.anchor(b))))

    # --- phụ đề + chip + chú thích ---
    def tc(t): t=max(0,t); return f"{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}"
    L=[]
    def ev(a,b,st,txt,tags="",layer=0):
        L.append(f"Dialogue: {layer},{tc(a)},{tc(b)},{st},,0,0,0,,{{{tags}}}{txt}")
    kept=[w for w in P.W if any(x-0.01<=w["start"] and w["end"]<=y+0.01 for x,y in P.keep)]
    runs,cur=[],[]
    for i,w in enumerate(kept):
        cur.append(w); n=kept[i+1] if i+1<len(kept) else None
        if n is None or n["seg"]!=w["seg"] or n["start"]-w["end"]>0.34 or P.t_of(n["start"])-P.t_of(w["end"])>0.20:
            runs.append(cur); cur=[]
    ch=[]
    for r in runs:
        n=len(r); k=max(1,math.ceil(n/3)); sz=[n//k+(1 if i<n%k else 0) for i in range(k)]; p=0
        for x in sz: ch.append(r[p:p+x]); p+=x
    block=[(a-0.05,b+0.05) for _,a,b in covers]+[(a-0.05,b) for _,a,b,_ in graf]
    ncap=0
    for i,c in enumerate(ch):
        a,b=P.t_of(c[0]["start"]),P.t_of(c[-1]["end"])+0.08
        if i+1<len(ch): b=min(b,P.t_of(ch[i+1][0]["start"])-0.01)
        if any(x<b and a<y for x,y in block): continue
        if b-a<0.2: b=a+0.2
        t=" ".join(x["word"] for x in c).upper()
        m=max(len(l) for l in t.split("\n")); size=int(max(54,min(100,880/(0.48*m))))
        ev(a,b,"Cap",t,f"\\fad(40,40)\\fs{size}"); ncap+=1
    for i,(txt,a,b) in enumerate(cfg.get("chips",[])):
        ev(P.t_of(P.anchor(a)),P.t_of(P.anchor(b)),"Chip",txt,"\\fad(150,150)")
    for txt,a,b in cfg.get("notes",[]):
        ev(P.t_of(P.anchor(a)),P.t_of(P.anchor(b)),"Note",txt,"\\fad(200,200)")
    ASS=f"""[Script Info]
ScriptType: v4.00+
PlayResX: {CW}
PlayResY: {CH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,{PD},90,&H00FFFFFF,&H00FFFFFF,&H00101208,&H00101208,0,0,0,0,100,100,1,0,1,6,3,2,70,70,{cfg.get('cap_mv',230)},1
Style: Chip,{PD},64,&H00101208,&H00101208,&H0000FFF0,&H0000FFF0,0,0,0,0,100,100,2,0,3,18,0,7,70,70,{cfg.get('chip_mv',150)},1
Style: Note,{PD},60,&H0000FFF0,&H0000FFF0,&H00101208,&H00101208,0,0,0,0,100,100,1,0,3,16,0,7,70,70,{cfg.get('note_mv',300)},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""+"\n".join(L)+"\n"
    open(f"{TMP}/subs.ass","w",encoding="utf-8").write(ASS)

    # --- A. cắt ghép, đẩy máy so le ---
    PUNCH=[1.0,1.05,1.0,1.035,1.0,1.045,1.0,1.03]
    fc=[];vl=[]
    for i,(a,b) in enumerate(P.keep):
        z=PUNCH[i%len(PUNCH)]
        fc.append(f"[0:v]trim={a:.4f}:{b:.4f},setpts=PTS-STARTPTS,scale={CW}:{CH}:flags=lanczos,"
                  f"scale=iw*{z}:ih*{z},crop={CW}:{CH},setsar=1[v{i}]"); vl.append(f"[v{i}]")
    fc.append("".join(vl)+f"concat=n={len(P.keep)}:v=1:a=0[vc]")
    fc.append(f"[vc]setpts=PTS/{P.speed},fps=30,format=yuv420p[v]")
    base=f"{TMP}/base.mp4"
    SKIPV=os.environ.get("SKIPV")=="1" and os.path.exists(base)
    if not SKIPV: run(["ffmpeg","-v","warning","-stats","-y","-i",SRC,"-filter_complex",";".join(fc),
         "-map","[v]","-an","-c:v","h264_videotoolbox","-b:v","20M","-r","30",base])
    fc2=[f"[0:a]atrim={a:.4f}:{b:.4f},asetpts=PTS-STARTPTS[a{i}]" for i,(a,b) in enumerate(P.keep)]
    fc2.append("".join(f"[a{i}]" for i in range(len(P.keep)))+f"concat=n={len(P.keep)}:v=0:a=1[ac]")
    fc2.append(f"[ac]atempo={P.speed},highpass=f=85,acompressor=threshold=0.10:ratio=3:attack=8:release=180,"
               f"loudnorm=I=-16:TP=-1.5:LRA=9[a]")
    if not (SKIPV and os.path.exists(f"{TMP}/voice.wav")):
        run(["ffmpeg","-v","error","-y","-i",SRC,"-filter_complex",";".join(fc2),
             "-map","[a]","-ac","2","-ar","48000",f"{TMP}/voice.wav"])

    # --- B. card + tiêu đề + phụ đề ---
    ins=["-i",base]; fc=[]; prev="0:v"; n=1
    for i,(p,a,b) in enumerate(covers):
        d=max(1,int(round((b-a)*30)))
        ins+=["-loop","1","-t",f"{b-a:.3f}","-i",p]
        fc.append(f"[{n}:v]fps=30,scale={CW*2}:{CH*2},zoompan=z='1+0.03*on/{max(1,d-1)}':d={d}:"
                  f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={CW}x{CH}:fps=30,setsar=1,"
                  f"setpts=PTS-STARTPTS+{a:.4f}/TB[cv{i}]")
        fc.append(f"[{prev}][cv{i}]overlay=0:0:eof_action=pass:enable='between(t,{a:.4f},{b:.4f})'[cx{i}]")
        prev=f"cx{i}"; n+=1
    for i,(p,a,b,y) in enumerate(graf):
        ins+=["-i",p]
        fc.append(f"[{n}:v]setsar=1[g{i}]")
        fc.append(f"[{prev}][g{i}]overlay=0:{y}:enable='between(t,{a:.4f},{b:.4f})'[gx{i}]")
        prev=f"gx{i}"; n+=1
    fc.append(f"[{prev}]subtitles='{TMP}/subs.ass':fontsdir='{F}',format=yuv420p[v]")
    comp=f"{TMP}/comp.mp4"
    run(["ffmpeg","-v","warning","-stats","-y"]+ins+["-filter_complex",";".join(fc),
         "-map","[v]","-an","-c:v","h264_videotoolbox","-b:v","18M","-r","30","-t",f"{T:.2f}",comp])

    # --- C. tiếng ---
    SFX=[]
    def add(f,t,tg):
        g=gain(f"{A}/{f}",tg)
        if g and t>=0: SFX.append((f,round(t,3),g))
    cutpts=[P.t_of(a) for a,_ in P.keep][1:]
    big=[i for i,g in enumerate(P.CUT_GAP) if g>0.75]
    for k,i in enumerate(big): add(f"sfx_Transitions_SFX_{(k%12)+1:02d}.wav", cutpts[i]-0.10, -30.0)
    for i,(p,a,b,y) in enumerate(graf): add(f"sfx_Subdrop_t1_{(i%5)+1:02d}.wav", a-0.15, -27.0)
    for i,(p,a,b) in enumerate(covers): add(f"sfx_HUD_Interface_{(i%4)+1:02d}.wav", a-0.06, -29.0)
    for i,(txt,a,b) in enumerate(cfg.get("chips",[])): add(f"sfx_Blobs_{(i%3)+1:02d}.wav", P.t_of(P.anchor(a))-0.05, -31.0)
    add("sfx_RH-RISER.wav", max(0,P.t_of(P.anchor(cfg["cta_at"]))-1.5), -27.0)
    SFX.sort(key=lambda x:x[1])
    mus=cfg.get("music",["mus_2_thatvlog.m4a"])
    seg=T/len(mus); MUSIC=[(i*seg,min(T,(i+1)*seg),m) for i,m in enumerate(mus)]
    ins=["-i",f"{TMP}/voice.wav"]; fc=[]; lab=["[0:a]"]; n=1
    for i,(a,b,f) in enumerate(MUSIC):
        g=gain(f"{A}/{f}",-34.0,cap=99); d=b-a
        ins+=["-stream_loop","3","-i",f"{A}/{f}"]
        fc.append(f"[{n}:a]atrim=0:{d:.3f},asetpts=N/SR/TB,volume={g},afade=t=in:st=0:d={1.2 if i else 0.8},"
                  f"afade=t=out:st={max(0,d-1.4):.3f}:d=1.4,adelay={int(a*1000)}|{int(a*1000)}[m{i}]")
        lab.append(f"[m{i}]"); n+=1
    for i,(f,t,g) in enumerate(SFX):
        ins+=["-i",f"{A}/{f}"]
        fc.append(f"[{n}:a]volume={g},aformat=sample_rates=48000:channel_layouts=stereo,"
                  f"adelay={int(t*1000)}|{int(t*1000)}[s{i}]"); lab.append(f"[s{i}]"); n+=1
    fc.append("".join(lab)+f"amix=inputs={len(lab)}:duration=first:normalize=0,loudnorm=I=-15.5:TP=-2.0:LRA=11,alimiter=limit=0.79:level=disabled[a]")
    mix=f"{TMP}/mix.m4a"
    run(["ffmpeg","-v","warning","-stats","-y"]+ins+["-filter_complex",";".join(fc),
         "-map","[a]","-t",f"{T:.2f}","-c:a","aac","-b:a","224k",mix])

    OUT=f"{OUTDIR}/{cfg['folder']}.mp4"
    run(["ffmpeg","-v","error","-y","-i",comp,"-i",mix,"-map","0:v","-map","1:a","-c","copy",
         "-shortest","-movflags","+faststart",OUT])   # tiếng cắt đúng theo độ dài hình
    print(f"  -> {OUT}  ({T:.1f}s, {ncap} phụ đề, {len(covers)} card, {len(SFX)} SFX)")
    return dict(out=OUT, total=T, plan=P, tmp=TMP, outdir=OUTDIR, ncap=ncap)
