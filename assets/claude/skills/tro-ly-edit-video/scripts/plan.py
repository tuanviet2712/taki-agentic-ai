# -*- coding: utf-8 -*-
"""Kế hoạch cắt dùng chung: dựa vào năng lượng âm thanh thật, không tin độ dài từ của Whisper."""
import json, wave, struct, math, os

FIX = {"cloud":"Claude","clound":"Claude","mymap":"mindmap","corework":"Cowork","cờ lốt":"Claude"}

class Plan:
    def __init__(self, wav, tr, speed=1.1, keep_pause=0.20, keep_long=0.28,
                 min_sil=0.33, hard_remove=()):
        self.speed=speed
        T=json.load(open(tr,encoding="utf-8"))
        W=[]
        for si,sg in enumerate(T["segments"]):
            for w in sg.get("words",[]):
                w["word"]=w["word"].strip(); w["seg"]=si; W.append(w)
        for w in W:
            lw=w["word"].lower().strip(".,!?")
            if lw in FIX: w["word"]=FIX[lw]
        for a,b in zip(W,W[1:]):
            if a["word"].lower()=="core" and b["word"].lower().startswith("work"):
                a["word"],b["word"]="Cowork",""
        self.W=[w for w in W if w["word"]]

        wf=wave.open(wav); n=wf.getnframes(); sr=wf.getframerate()
        s=struct.unpack(f"<{n}h", wf.readframes(n))
        FR=int(sr*0.02); self.HOP=0.02; env=[]
        for i in range(0,n-FR,FR):
            acc=0
            for k in range(i,i+FR,4): acc+=s[k]*s[k]
            env.append(20*math.log10(math.sqrt(acc/(FR/4))/32768+1e-9))
        self.ENV=env
        srt=sorted(env)
        self.FLOOR=srt[int(len(srt)*0.10)]; self.SPEECH=srt[int(len(srt)*0.85)]
        self.THR=self.FLOOR+max(6.0,(self.SPEECH-self.FLOOR)*0.28)
        self.DUR=len(env)*self.HOP

        SIL=[]; i=0
        while i<len(env):
            if env[i]<self.THR:
                j=i
                while j<len(env) and env[j]<self.THR: j+=1
                if (j-i)*self.HOP>min_sil: SIL.append((i*self.HOP,j*self.HOP))
                i=j
            else: i+=1
        self.SIL=SIL
        self.HEAD=max(0.0,(SIL[0][1] if SIL and SIL[0][0]<0.2 else 0.5)-0.25)
        self.TAIL=min(self.DUR,(SIL[-1][0] if SIL and SIL[-1][1]>self.DUR-0.5 else self.DUR)+0.55)

        rem=[list(x) for x in hard_remove]
        for a,b in SIL:
            if b<=self.HEAD or a>=self.TAIL: continue
            pad=(keep_long if b-a>1.2 else keep_pause)/2
            x,y=a+pad,b-pad
            if y-x>0.06: rem.append([x,y])
        rem.sort(); merged=[]
        for a,b in rem:
            if merged and a<=merged[-1][1]+0.01: merged[-1][1]=max(merged[-1][1],b)
            else: merged.append([a,b])
        keep=[]; cur=self.HEAD
        for a,b in merged:
            if b<=self.HEAD or a>=self.TAIL: continue
            a=max(a,self.HEAD)
            if a>cur: keep.append((cur,a))
            cur=max(cur,b)
        if cur<self.TAIL: keep.append((cur,self.TAIL))
        self.keep=[(a,b) for a,b in keep if b-a>0.12]
        self.CUT_GAP=[round(self.keep[i][0]-self.keep[i-1][1],3) for i in range(1,len(self.keep))]
        self.removed=sum(b-a for a,b in merged if a>=self.HEAD and b<=self.TAIL)
        self.TOTAL=self.t_of(self.TAIL)
        for w in self.W:
            w["start"]=max(w["start"],self.snap(w["start"]))
            if w["end"]-w["start"]>0.9: w["end"]=min(w["end"],self.snap(w["end"],back=True))
            if w["end"]<=w["start"]: w["end"]=w["start"]+0.12

    def t_of(self,src):
        acc=0.0
        for a,b in self.keep:
            if src<a: return acc/self.speed
            if src<=b: return (acc+(src-a))/self.speed
            acc+=b-a
        return acc/self.speed
    def in_keep(self,t): return any(a-0.01<=t<=b+0.01 for a,b in self.keep)
    def anchor(self,t):
        if self.in_keep(t): return t
        for a,b in self.keep:
            if a>t: return a+0.05
        return t
    def snap(self,t,back=False):
        i=int(t/self.HOP); st=-1 if back else 1
        for k in range(60):
            j=i+k*st
            if 0<=j<len(self.ENV) and self.ENV[j]>=self.THR: return j*self.HOP
        return t
    def text(self):
        return " ".join(w["word"] for w in self.W)
    def report(self):
        return (f"nền {self.FLOOR:.1f} dB · nói {self.SPEECH:.1f} dB · ngưỡng {self.THR:.1f} dB | "
                f"{len(self.SIL)} quãng im, cắt {self.removed:.1f}s | giữ {len(self.keep)} đoạn | "
                f"{self.DUR:.1f}s -> {self.TOTAL:.1f}s ({int(self.TOTAL//60)}:{self.TOTAL%60:04.1f})")
