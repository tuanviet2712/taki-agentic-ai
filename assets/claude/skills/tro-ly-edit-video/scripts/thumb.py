# -*- coding: utf-8 -*-
"""Ảnh bìa kiểu 'Bìa Hai Dòng' (font bìa trong cau-hinh.json) — mặt/màn hình nét ở trên, nửa dưới mờ cho chữ nổi."""
import os, subprocess, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import struct, zlib
import kit
from kit import find as KFIND
A = kit.kho(); F=f"{A}/fonts"
W,H=1080,1920; SAFE_TOP,SAFE_BOT=240,1680; BLUR_FROM=880
YEL="0xf0ff00"; INK="0x101208"
FONT=kit.ten_font("bia")
def esc(t): return t.replace(":","\\:").replace("'","\u2019")
def dt(f,t,s,c,x,y): return f"drawtext=fontfile='{F}/{f}':text='{esc(t)}':fontsize={s}:fontcolor={c}:x={x}:y={y}:expansion=none"
def box(x,y,w,h,c,a=1): return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={c}@{a}:t=fill"
def run(c): subprocess.run(c,check=True)
_M={}
def measure(font,text,size):
    k=(font,text,size)
    if k in _M: return _M[k]
    p="/tmp/_tm.png"; hh=int(size*2.3)
    run(["ffmpeg","-v","error","-y","-f","lavfi","-i",f"color=c=black:s=2600x{hh}",
         "-vf",dt(font,text,size,"white","40","20"),"-frames:v","1",p])
    raw=subprocess.run(["ffmpeg","-v","error","-i",p,"-pix_fmt","gray","-f","rawvideo","-"],capture_output=True).stdout
    xs=[x for x in range(2600) if any(raw[y*2600+x]>40 for y in range(0,hh,3))]
    ys=[y for y in range(hh) if any(raw[y*2600+x]>40 for x in range(0,2600,3))]
    _M[k]=(xs[-1]-xs[0]+1,ys[-1]-ys[0]+1,xs[0]-40,ys[0]-20) if xs and ys else (0,0,0,0)
    return _M[k]
def fit(font,t,tw,cap):
    s=cap
    while s>18 and measure(font,t,s)[0]>tw: s-=6
    return s
def png(path,fn,h):
    px=bytearray(W*h*4)
    for y in range(h):
        r,g,b,a=fn(y)
        for x in range(W):
            i=(y*W+x)*4; px[i:i+4]=bytes((r,g,b,a))
    raw=b"".join(b"\x00"+bytes(px[y*W*4:(y+1)*W*4]) for y in range(h))
    def ch(t,d):
        c=t+d; return struct.pack(">I",len(d))+c+struct.pack(">I",zlib.crc32(c)&0xffffffff)
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+ch(b"IHDR",struct.pack(">IIBBBBB",W,h,8,6,0,0,0))
                          +ch(b"IDAT",zlib.compress(raw,6))+ch(b"IEND",b""))

def make(src, at, l1, l2, sub, badge, out, crop_up=170, logo=True):
    T=os.path.dirname(out) or "."
    run(["ffmpeg","-v","error","-y","-ss",str(at),"-i",src,"-frames:v","1",
         "-vf",f"scale={W}:{H}:flags=lanczos,crop={W}:{H-crop_up}:0:{crop_up},scale={W}:{H}:flags=lanczos,"
               "eq=contrast=1.06:saturation=1.06","/tmp/_tf.png"])
    FADE=230
    png("/tmp/_tmask.png", lambda y:(lambda v:(v,v,v,255))(0 if y<BLUR_FROM else min(255,int(255*(y-BLUR_FROM)/FADE))), H)
    png("/tmp/_tdark.png", lambda y:(16,18,8, 0 if y<BLUR_FROM-70 else min(226,int(226*(y-(BLUR_FROM-70))/330))), H)
    s1=fit(FONT,l1,930,168); s2=fit(FONT,l2,930,214); s3=fit(FONT,sub,900,58)
    bfs=fit(FONT,badge,700,68); bw,bh,bx,by_=measure(FONT,badge,bfs)
    Y1=968; Y2=Y1+int(s1*1.04); Y3=Y2+int(s2*1.16); BY=SAFE_BOT-100-(bh+70)
    # tiêu đề ngắn thì chữ to hết cỡ → dòng phụ đè lên nhãn. Thiếu chỗ bao nhiêu thì đẩy cả khối lên bấy nhiêu.
    thieu=(Y3+46+int(s3*1.3)+36)-BY
    if thieu>0: Y1-=thieu; Y2-=thieu; Y3-=thieu
    L=[dt(FONT,l1,s1,"white",70,Y1), dt(FONT,l2,s2,YEL,70,Y2),
       box(70,Y3+8,150,12,"0xff5a4a"), dt(FONT,sub,s3,"white",70,Y3+46),
       box(70,BY,bw+92,bh+70,YEL), dt(FONT,badge,bfs,INK,70+46-bx,BY+35-by_)]
    base=("[0]split[sh][fb];[fb]boxblur=26:2[bl];[bl][1]alphamerge[blm];"
          "[sh][blm]overlay=0:0[m1];[m1][2]overlay=0:0[m2];")
    ins=["-i","/tmp/_tf.png","-i","/tmp/_tmask.png","-i","/tmp/_tdark.png"]
    if logo:
        ins+=["-i",f"{A}/claude_badge.png"]
        fc=base+"[3]scale=260:-1[lg];[m2][lg]overlay=W-w-70:300,"+",".join(L)
    else:
        fc=base+"[m2]"+",".join(L)
    run(["ffmpeg","-v","error","-y"]+ins+["-filter_complex",fc,"-frames:v","1",out])
    return out
