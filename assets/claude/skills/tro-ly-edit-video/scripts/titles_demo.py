# -*- coding: utf-8 -*-
"""Dựng lại có QUẦNG SÁNG (Loé sáng 2) + cách đặt lệch chữ to/nhỏ như bộ gốc."""
import os, subprocess, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import kit
from kit import find as KFIND


def chay():
    """Sinh toàn bộ tài nguyên của script này."""
    A = kit.kho(); F=f"{A}/fonts"
    OUT=os.path.expanduser("~/Downloads/MAU-CHU-CO-QUANG-SANG.mp4")
    W,H=1080,1920; FONT=kit.ten_ass("phu_de")
    L=[];names=[]
    def tc(t): return f"{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}"
    def ev(a,b,st,txt,tags="",layer=0):
        L.append(f"Dialogue: {layer},{tc(a)},{tc(b)},{st},,0,0,0,,{{{tags}}}{txt}")
    def glow(a,b,txt,x,y,size,col,steps=((26,120),(16,80),(9,50)),base=0,extra=""):
        """quầng sáng = vẽ lại chữ nhiều lần với độ nhoè giảm dần, alpha thấp, rồi chữ nét lên trên"""
        for k,(bl,al) in enumerate(steps):
            ev(a,b,"G",txt,f"\\an5\\pos({x},{y})\\fs{size}\\1c{col}\\3c{col}\\bord6\\blur{bl}"
                           f"\\alpha&H{al:02X}&{extra}",layer=base+k)
        ev(a,b,"G",txt,f"\\an5\\pos({x},{y})\\fs{size}\\1c{col}\\bord0{extra}",layer=base+len(steps))
    D=1.25
    def blk(i,n,goc):
        t=(i-1)*D; names.append(n)
        ev(t,t+D,"Lab",f"{i:02d} · {n}","\\fad(80,80)")
        ev(t,t+D,"Src",f"bộ gốc\\: {goc}","\\fad(80,80)")
        return t
    YEL="&H0000FFF0&"; WHT="&H00FFFFFF&"; BLU="&H00FF9B5D&"; GRN="&H0052A0FF&"
    CY=980
    # 01 quầng vàng, chữ to + chữ nhỏ lệch trên-trái  (Tương lai / Tiền tệ)
    t=blk(1,"Lệch Trên","Tương lai / Tiền tệ")
    glow(t,t+D,"Tương lai",int(W*0.40),CY-96,84,WHT,base=0)
    glow(t+0.08,t+D,"Tiền tệ",int(W*0.56),CY+6,136,YEL,base=5)
    # 02 chữ nhỏ hai bên  (Texto1 / Poppins / Texto2)
    t=blk(2,"Kẹp Hai Bên","Texto1 / Poppins / Texto2")
    glow(t,t+D,"Bí quyết",int(W*0.34),CY-92,72,WHT,base=0)
    glow(t+0.10,t+D,"TĂNG VIEW",int(W*0.50),CY+4,140,YEL,base=5)
    glow(t+0.18,t+D,"nhanh gọn",int(W*0.68),CY+96,72,WHT,base=10)
    # 03 chữ nhỏ lệch dưới-phải  (BẤT NGỜ / chưa)
    t=blk(3,"Lệch Dưới","BẤT NGỜ / chưa")
    glow(t,t+D,"BẤT NGỜ",int(W*0.46),CY-40,132,YEL,base=0)
    glow(t+0.10,t+D,"chưa",int(W*0.60),CY+62,104,WHT,base=5)
    # 04 quầng xanh đậm  (THỜI GIAN)
    t=blk(4,"Quầng Xanh","THỜI GIAN")
    glow(t,t+D,"THỜI GIAN",W//2,CY,132,BLU,steps=((34,100),(20,64),(10,40)))
    # 05 vàng + trắng  (Hạn mức / Vay)
    t=blk(5,"Hạn Mức","Hạn mức / Vay")
    glow(t,t+D,"Hạn mức",int(W*0.44),CY-44,132,YEL,base=0)
    glow(t+0.08,t+D,"Vay",int(W*0.60),CY+56,100,WHT,base=5)
    # 06 chữ rỗng có quầng  (OUTLINE TEXT)
    t=blk(6,"Chữ Rỗng Sáng","OUTLINE TEXT")
    for k,(bl,al) in enumerate(((24,120),(14,80))):
        ev(t,t+D,"G","CHỮ RỖNG",f"\\an5\\pos({W//2},{CY-80})\\fs150\\1a&HFF&\\3c{YEL}\\bord10\\blur{bl}\\alpha&H{al:02X}&",layer=k)
        ev(t,t+D,"G","PHÁT SÁNG",f"\\an5\\pos({W//2},{CY+80})\\fs150\\1a&HFF&\\3c{YEL}\\bord10\\blur{bl}\\alpha&H{al:02X}&",layer=k)
    ev(t,t+D,"G","CHỮ RỖNG",f"\\an5\\pos({W//2},{CY-80})\\fs150\\1a&HFF&\\3c{YEL}\\bord5",layer=3)
    ev(t,t+D,"G","PHÁT SÁNG",f"\\an5\\pos({W//2},{CY+80})\\fs150\\1a&HFF&\\3c{YEL}\\bord5",layer=3)
    # 07 viền chồng 3 lớp + quầng  (CARTOON)
    t=blk(7,"Viền Chồng","CARTOON")
    for k,(bw,c) in enumerate(((17,"&H002BC9F9&"),(13,"&H000000FF&"),(7,WHT))):
        ev(t,t+D,"G","HOẠT HÌNH",f"\\an5\\pos({W//2},{CY})\\fs140\\1c{YEL}\\bord{bw}\\3c{c}"
           f"\\fscx60\\fscy60\\t(0,140,\\fscx106\\fscy106)\\t(140,240,\\fscx100\\fscy100)",layer=k)
    # 08 loé sáng nhấp nháy  (Flicker + Loé sáng 2)
    t=blk(8,"Loé Nhấp Nháy","Flicker Style +Sound")
    glow(t,t+D,"NHẤP NHÁY",W//2,CY,140,YEL)
    for k in range(4):
        s=t+0.06+k*0.11
        ev(s,s+0.05,"G","NHẤP NHÁY",f"\\an5\\pos({W//2},{CY})\\fs140\\1c{WHT}\\blur14",layer=8)
    # 09 bong bóng nảy  (Aparición burbujeante)
    t=blk(9,"Bong Bóng","Aparición burbujeante")
    glow(t,t+D,"BONG BÓNG",W//2,CY,132,YEL,extra="\\fscx20\\fscy20\\t(0,110,\\fscx120\\fscy120)\\t(110,210,\\fscx100\\fscy100)")
    # 10 lùi xa kèm nhoè  (Alejar con desenfoque)
    t=blk(10,"Lùi Nhoè","Alejar con desenfoque")
    glow(t,t+D,"LÙI NHOÈ",W//2,CY,132,WHT,extra="\\fscx155\\fscy155\\t(0,300,\\fscx100\\fscy100)")
    # 11 đèn hỏng  (Fallo de linterna)
    t=blk(11,"Đèn Hỏng","Fallo de linterna")
    segs=[(1,.08),(0,.05),(1,.04),(0,.06),(1,.05),(0,.04),(1,.93)]
    for k,(on,dur) in enumerate(segs):
        s=t+sum(x[1] for x in segs[:k])
        if on: glow(s,s+dur,"ĐÈN HỎNG",W//2,CY,132,YEL)
    # 12 quét sáng  (Light Sweep)
    t=blk(12,"Quét Sáng","Light Sweep")
    ev(t,t+D,"G","QUÉT SÁNG",f"\\an5\\pos({W//2},{CY})\\fs132\\1c&H00606060&\\bord0")
    glow(t,t+D,"QUÉT SÁNG",W//2,CY,132,WHT,steps=((18,90),),base=3,
         extra=f"\\clip({W//2-430},{CY-95},{W//2-330},{CY+95})\\t(0,1000,\\clip({W//2+330},{CY-95},{W//2+430},{CY+95}))")
    # 13 bảng lật lên  (Cartel publicitario hacia arriba)
    t=blk(13,"Bảng Lật","Cartel publicitario hacia arriba")
    for k,w in enumerate(["BẢNG","LẬT LÊN"]):
        s=t+k*0.13
        glow(s,t+D,w,W//2,CY-70+k*140,116,YEL if k else WHT,base=k*5,
             extra="\\fscy10\\alpha&HFF&\\t(0,130,\\fscy116\\alpha&H00&)\\t(130,220,\\fscy100)")
    # 14 đếm ngược  (100-0 €)
    t=blk(14,"Đếm Ngược","100 - 0 €")
    vals=[100,84,69,55,42,30,20,12,6,2,0]
    for k,v in enumerate(vals):
        a=t+k*(D-0.08)/len(vals); b=t+(k+1)*(D-0.08)/len(vals) if k<len(vals)-1 else t+D
        glow(a,b,f"{v}€",W//2,CY,146,YEL)
    TOTAL=14*D
    ASS=f"""[Script Info]
    ScriptType: v4.00+
    PlayResX: {W}
    PlayResY: {H}
    WrapStyle: 2
    ScaledBorderAndShadow: yes

    [V4+ Styles]
    Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
    Style: G,{FONT},120,&H00FFFFFF,&H00FFFFFF,&H00101208,&H00101208,0,0,0,0,100,100,1,0,1,0,0,5,40,40,40,1
    Style: Lab,{FONT},54,&H0000FFF0,&H0000FFF0,&H00101208,&H00101208,0,0,0,0,100,100,3,0,1,4,0,2,70,70,250,1
    Style: Src,{FONT},40,&H00909090,&H00909090,&H00101208,&H00101208,0,0,0,0,100,100,2,0,1,3,0,2,70,70,190,1

    [Events]
    Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    """+"\n".join(L)+"\n"
    p=f"{A}/_show2.ass"; open(p,"w",encoding="utf-8").write(ASS)
    subprocess.run(["ffmpeg","-v","warning","-stats","-y","-f","lavfi",
      "-i",f"color=c=0x08090a:s={W}x{H}:d={TOTAL:.2f}:r=30",
      "-filter_complex",f"[0:v]subtitles='{p}':fontsdir='{F}',format=yuv420p[v]",
      "-map","[v]","-c:v","h264_videotoolbox","-b:v","14M","-t",f"{TOTAL:.2f}",OUT],check=True)
    print("XONG:",OUT,f"{TOTAL:.1f}s")
    print(" · ".join(f"{i+1:02d} {n}" for i,n in enumerate(names)))



if __name__ == "__main__":
    chay()
