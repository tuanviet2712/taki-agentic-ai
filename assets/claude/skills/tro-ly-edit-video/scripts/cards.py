# -*- coding: utf-8 -*-
"""Dựng cảnh trám kiểu giao diện: vẽ đúng thứ đang nói, không dùng icon vector."""
import os, subprocess, sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import kit
from kit import find as KFIND


def chay():
    """Sinh toàn bộ tài nguyên của script này."""
    A = kit.kho(); F=f"{A}/fonts"; OUT=f"{A}/cards"
    D=kit.ten_font("than"); DB=kit.ten_font("phu_de"); SERIF=kit.ten_font("serif")   # theo cau-hinh.json
    os.makedirs(OUT,exist_ok=True)
    W,H=1080,1920
    BLACK="0x101208"; PAPER="0xf7f5ee"; INK="0x14160d"; GREY="0x585d47"; YEL="0xf0ff00"; RED="0xff5a4a"; GRN="0x7fd44b"
    _TXTN=[0]
    TXTDIR=f"{OUT}/_txt"; os.makedirs(TXTDIR,exist_ok=True)
    def txt(f,t,size,col,x,y):
        """ghi chữ ra file rồi để drawtext đọc -> không còn lỗi thoát ký tự với %, :, dấu tiếng Việt"""
        _TXTN[0]+=1
        fp=f"{TXTDIR}/t{_TXTN[0]}.txt"
        open(fp,"w",encoding="utf-8").write(t)
        return f"drawtext=fontfile='{F}/{f}':textfile='{fp}':fontsize={size}:fontcolor={col}:x={x}:y={y}:expansion=none"

    def box(x,y,w,h,col,a=1): return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={col}@{a}:t=fill"
    def build(name, parts, bg=BLACK):
        fc="[0]"+",".join(parts)
        subprocess.run(["ffmpeg","-v","error","-y","-f","lavfi","-i",f"color=c={bg}:s={W}x{H}",
                        "-filter_complex",fc,"-frames:v","1",f"{OUT}/{name}.png"],check=True)
        return f"{OUT}/{name}.png"

    # ================= NGÔN NGỮ CHUNG =================
    KICK=lambda t:[box(60,470,960,120,BLACK), txt(DB,t,46,YEL,110,500)]
    def badge(t,col,y=1520): return [box(60,y,700,104,col), txt(DB,t,56,BLACK,92,y+22)]
    def card(x,y,w,h): return [box(x,y,w,h,PAPER), box(x,y,w,12,INK)]

    # ---------- Lỗi 1: cùng một slide, hai phông chữ ----------
    def slide(fontfile, bdg, bcol, label):
        return KICK(label)+card(60,640,960,600)+[
          txt(fontfile,"BÁO CÁO QUÝ 4",92,INK,110,715),
          txt(fontfile,"Doanh thu tăng 32%",46,GREY,110,860),
          txt(fontfile,"Khách hàng mới 1.240",46,GREY,110,935),
          txt(fontfile,"Chi phí giảm 11%",46,GREY,110,1010),
          box(110,1120,320,10,"0xd8b400"),
        ]+badge(bdg,bcol,1300)
    build("cut1a", slide(SERIF,"AI TỰ CHỌN PHÔNG",RED,"SLIDE AI TRẢ VỀ"))
    build("cut1b", slide(D,"MÌNH CHỈ ĐỊNH PHÔNG",YEL,"SAU KHI THÊM LỆNH"))

    # ---------- Lỗi 2a: slide đặc chữ  vs  slide có dẫn chứng ----------
    lines=["Chuyển đổi số giúp doanh nghiệp","tối ưu quy trình vận hành và",
           "nâng cao trải nghiệm khách hàng","thông qua việc ứng dụng công",
           "nghệ vào từng khâu nghiệp vụ","nhằm gia tăng hiệu quả tổng thể"]
    p2=KICK("SLIDE AI TỰ LÀM")+card(60,640,960,620)+[txt(DB,"CHUYỂN ĐỔI SỐ",64,INK,110,700)]
    for i,l in enumerate(lines): p2.append(txt(D,l,36,GREY,110,810+i*62))
    build("cut2a", p2+badge("TOÀN CHỮ, KHÔNG DẪN CHỨNG",RED,1320))
    p3=KICK("SAU KHI ĐƯA ẢNH + SỐ LIỆU")+card(60,640,960,620)+[
      txt(DB,"CHUYỂN ĐỔI SỐ",64,INK,110,700),
      box(110,800,400,300,"0xcfd8c4"), box(110,800,400,300,"0x9aa88c",0.55),
      txt(D,"ảnh thực tế tại kho",30,"0x3d4432",130,940),
      txt(DB,"32%",92,INK,570,810), txt(D,"tiết kiệm chi phí",34,GREY,570,915),
      txt(DB,"1.240",92,INK,570,975), txt(D,"khách hàng mới",34,GREY,570,1080),
    ]
    build("cut2b", p3+badge("CÓ ẢNH THẬT, CÓ SỐ THẬT",YEL,1320))

    # ---------- Lỗi 2c: gom ảnh vào một thư mục rồi tải lên Cowork ----------
    p4=KICK("CLAUDE COWORK")+[box(60,640,960,420,"0x1b1f14")]
    for i in range(8):
        p4.append(box(100+ (i%4)*230, 690+(i//4)*180, 200, 150, "0x3a4230"))
    p4+=[txt(D,"12 ảnh + 3 video trong 1 thư mục",40,YEL,100,1080),
         box(60,1180,960,180,"0x1b1f14"),
         txt(D,"Tải cả thư mục lên Cowork rồi bảo",38,PAPER,100,1215),
         txt(D,"AI tự chọn ảnh hợp từng slide",38,PAPER,100,1272)]
    build("cut2c", p4+badge("ĐƯA TƯ LIỆU THẬT CHO AI",YEL,1440))

    # ---------- Lỗi 3a: biểu đồ cột mọc dần (3 trạng thái) ----------
    VALS=[(230,"Q1"),(330,"Q2"),(280,"Q3"),(430,"Q4")]
    def chart(n):
        p=KICK("YÊU CẦU AI VẼ BIỂU ĐỒ")+card(60,640,960,720)+[txt(DB,"DOANH THU 4 QUÝ",56,INK,110,700)]
        base=1280
        for i,(v,lb) in enumerate(VALS):
            x=150+i*210
            if i<n: p.append(box(x,base-v,140,v,"0xd8b400" if i!=3 else "0x1b1f14"))
            p.append(txt(D,lb,34,GREY,x+45,base+14))
        p.append(box(110,base,860,4,"0xc9c6b6"))
        return p
    for i in range(1,5): build(f"cut3a{i}", chart(i)+badge("SỐ LIỆU THÀNH HÌNH ẢNH",YEL,1440))

    # ---------- Lỗi 3b: sơ đồ tư duy mọc dần ----------
    ROOT=(370,700,340,110)
    KIDS=[(90,940,300,100,"Dẫn chứng"),(690,940,300,100,"Số liệu"),(370,1160,340,100,"Kết luận")]
    def mind(n):
        p=KICK("YÊU CẦU AI VẼ SƠ ĐỒ TƯ DUY")+[box(60,640,960,760,"0x181c11")]
        rx,ry,rw,rh=ROOT; rcx=rx+rw//2
        if n>=2:                                        # thanh ngang nối 2 nhánh con
            p.append(box(240,ry+rh+50,600,4,"0x6f7a58"))
            p.append(box(rcx-2,ry+rh,4,50,"0x6f7a58"))
        for i,(x,y,w,h,t) in enumerate(KIDS):
            if i+2>n: continue
            cx=x+w//2
            if i<2: p.append(box(cx-2,ry+rh+50,4,y-(ry+rh+50),"0x6f7a58"))
            else:   p.append(box(cx-2,1040,4,120,"0x6f7a58"))
            p+=[box(x,y,w,h,"0x2b3220"), box(x,y,6,h,YEL), txt(DB,t,42,PAPER,x+26,y+26)]
        p+=[box(rx,ry,rw,rh,YEL), txt(DB,"NỘI DUNG CHÍNH",44,BLACK,rx+24,ry+30)]
        return p
    for i in range(1,5): build(f"cut3b{i}", mind(i)+badge("NHÌN LÀ HIỂU, KHỎI ĐỌC CHỮ",YEL,1500))

    # ---------- Lỗi 4a: gạch đầu dòng hiện theo từng cú click ----------
    BUL=["Tối ưu quy trình","Giảm chi phí vận hành","Tăng trải nghiệm khách"]
    def clicks(n):
        p=KICK("MỖI LẦN CLICK RA MỘT Ý")+card(60,640,960,620)+[txt(DB,"LỢI ÍCH",64,INK,110,700)]
        for i,b in enumerate(BUL[:n]):
            p+=[box(110,848+i*120,20,20,"0xd8b400"), txt(D,b,46,INK,152,822+i*120)]
        p.append(txt(DB,f"CLICK {n}/3",36,"0x8a8f76",790,1180))
        return p
    for i in range(1,4): build(f"cut4a{i}", clicks(i)+badge("XUẤT RA FILE POWERPOINT",YEL,1320))

    # ---------- Lỗi 4b: Canva mất chuyển động, Google Trình bày giữ được ----------
    def cross(x,y,s,col,t=14):      # dấu X vẽ bằng hai thanh nghiêng -> không phụ thuộc font
        return [box(x,y+s//2-t//2,s,t,col)]
    p6=KICK("TẢI FILE PPTX LÊN ĐÂU?")+[
     box(60,700,450,560,"0x2a1a18"), box(60,700,450,14,RED),
     txt(DB,"CANVA",58,PAPER,96,750),
     txt(DB,"SAI",96,RED,96,860),
     txt(D,"mất hết",40,PAPER,96,1010), txt(D,"chuyển động",40,PAPER,96,1065),
     box(570,700,450,560,"0x1f2a18"), box(570,700,450,14,YEL),
     txt(DB,"GOOGLE",50,PAPER,606,750), txt(DB,"TRÌNH BÀY",50,PAPER,606,806),
     txt(DB,"ĐÚNG",96,YEL,606,880),
     txt(D,"giữ nguyên",40,PAPER,606,1030), txt(D,"chuyển động",40,PAPER,606,1085),
    ]
    build("cut4b", p6+badge("GIỮ ĐƯỢC CHUYỂN ĐỘNG",YEL,1360))
    print("tổng cảnh trám:", len([f for f in os.listdir(OUT) if f.endswith(".png")]))



if __name__ == "__main__":
    chay()
