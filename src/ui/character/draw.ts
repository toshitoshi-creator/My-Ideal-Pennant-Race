// src/ui/character/draw.ts
//
// PlayerAppearance（domain層）を実際にCanvasへ描く処理。
// CanvasRenderingContext2D に依存するため ui 配下に置く。
// ロジック（どのパーツ・どの色になるか）は一切持たず、
// 受け取った PlayerAppearance をそのまま絵にするだけ。

import type { PlayerAppearance } from "../../domain/character/appearance";

type Ctx = CanvasRenderingContext2D;

/** 描画関数の内部でだけ使うパレット。PlayerAppearance から作る（toPalette参照） */
interface Palette {
  head: number;
  skin: string;
  line: string;
  blush: string;
  hair: string;
  hairline: string;
  eye: string;
  brow: string;
  mouth: string;
  beard: string;
  cloth1: string;
  cloth2: string;
  hat1: string;
  hat2: string;
  glass: string;
  lensColor: string;
  lens: number;
  extra: string;
  item: string;
  eyegap: number;
  eyey: number;
}

interface PartDef {
  n: string;
  d(c: Ctx, p: Palette): void;
}

interface HairDef {
  n: string;
  front?(c: Ctx, p: Palette): void;
  back?(c: Ctx, p: Palette): void;
}

interface HatDef {
  n: string;
  d(c: Ctx, p: Palette): void;
  textY: number;
}

interface HairFillOptions {
  gloss?: boolean;
  gx?: number;
  gy?: number;
  gr?: number;
  strands?: readonly (readonly number[])[];
}

const V = 400;
const EYE_Y = 208, EYE_DX = 47, BROW_Y = 180, NOSE_Y = 230, MOUTH_Y = 260;
const LW = 6;

function fs(c: Ctx, fill: string | null | undefined, line: string | null | undefined, lw?: number): void {
  if(fill){ c.fillStyle = fill; c.fill(); }
  if(line){ c.lineWidth = (lw==null?LW:lw); c.strokeStyle = line; c.lineJoin="round"; c.lineCap="round"; c.stroke(); }
}
function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.moveTo(x+r,y);
  c.arcTo(x+w,y,x+w,y+h,r);
  c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r);
  c.arcTo(x,y,x+w,y,r);
  c.closePath();
}
function headPath(c: Ctx, i: number): void {
  c.beginPath();
  if(i===0){ c.ellipse(200,176,116,112,0,0,Math.PI*2); }
  else if(i===1){
    c.moveTo(200,64);
    c.bezierCurveTo(318,64,326,176,286,238);
    c.bezierCurveTo(262,282,234,288,200,288);
    c.bezierCurveTo(166,288,138,282,114,238);
    c.bezierCurveTo(74,176,82,64,200,64);
  }
  else if(i===2){
    c.moveTo(200,64);
    c.bezierCurveTo(268,64,314,96,314,150);
    c.lineTo(314,228);
    c.bezierCurveTo(314,268,286,290,240,290);
    c.lineTo(160,290);
    c.bezierCurveTo(114,290,86,268,86,228);
    c.lineTo(86,150);
    c.bezierCurveTo(86,96,132,64,200,64);
  }
  else if(i===3){
    c.moveTo(200,64);
    c.bezierCurveTo(300,64,318,116,318,172);
    c.lineTo(298,232);
    c.bezierCurveTo(282,280,248,290,200,290);
    c.bezierCurveTo(152,290,118,280,102,232);
    c.lineTo(82,172);
    c.bezierCurveTo(82,116,100,64,200,64);
  }
  else if(i===4){ c.ellipse(200,178,102,124,0,0,Math.PI*2); }
  else { c.ellipse(200,182,126,106,0,0,Math.PI*2); }
}

/* ---------------- パーツ定義 ---------------- */


export const HEADS: readonly string[] = ["まる","たまご","しかく","ホームベース","おもなが","ぷっくり"];

/**
 * 色を明るく/暗くする。
 *
 * 球団色をユニフォームや帽子に流し込むとき、差し色を自動で作るために使う
 * （CanvasPortrait.tsx から呼ばれる）。amt が正なら明るく、負なら暗くする。
 */
export function shade(hex: string, amt: number): string {
  const n=parseInt(hex.slice(1),16);
  let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  if(amt>=0){ r+=(255-r)*amt; g+=(255-g)*amt; b+=(255-b)*amt; }
  else { r*=(1+amt); g*=(1+amt); b*=(1+amt); }
  const h=function(v: number){ return ("0"+Math.max(0,Math.min(255,Math.round(v))).toString(16)).slice(-2); };
  return "#"+h(r)+h(g)+h(b);
}
// 髪を塗る → 内側にツヤと毛流れ → 輪郭線
function hairFill(c: Ctx, p: Palette, shape: (c: Ctx) => void, opt: HairFillOptions = {}): void {
  const P = p;
  opt = opt || {};
  c.beginPath(); shape(c); fs(c,P.hair,P.hairline);
  c.save();
  c.beginPath(); shape(c); c.clip();
  if(opt.gloss !== false){
    const gx = opt.gx==null?164:opt.gx, gy = opt.gy==null?106:opt.gy, gr = opt.gr==null?62:opt.gr;
    c.globalAlpha = .34;
    c.beginPath(); c.ellipse(gx,gy,gr,11,-0.34,0,Math.PI*2); fs(c, shade(P.hair,.5), null);
    c.globalAlpha = .22;
    c.beginPath(); c.ellipse(gx+gr*0.42,gy+16,gr*0.34,7,-0.34,0,Math.PI*2); fs(c, shade(P.hair,.5), null);
    c.globalAlpha = 1;
  }
  c.globalAlpha = .38; c.strokeStyle = shade(P.hair,-.45); c.lineWidth = 5; c.lineCap = "round";
  (opt.strands || [[78,236],[126,176],[272,172],[320,232]]).forEach(function(t){
    c.beginPath(); c.moveTo(198,54);
    c.quadraticCurveTo(t[0]<198?142:256, (54+t[1])/2-26, t[0], t[1]);
    c.stroke();
  });
  c.restore();
}
// ギザギザの前髪（右端→左端）
function bangJag(c: Ctx): void {
  c.lineTo(318,246); c.lineTo(298,198);
  c.bezierCurveTo(294,150,270,126,246,130);
  c.lineTo(226,166);
  c.bezierCurveTo(216,134,196,120,176,126);
  c.lineTo(156,164);
  c.bezierCurveTo(144,136,122,130,106,146);
  c.lineTo(100,198); c.lineTo(82,246);
}


const HAIRS: HairDef[] = [
  {n:"なし", front(){}, back(){}},
  {n:"ショート", front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,126,152,0,Math.PI,0);
        bangJag(c);
        c.closePath();
      });
  }},
  {n:"七三", front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,126,152,0,Math.PI,0);
        c.lineTo(320,244); c.lineTo(300,196);
        c.bezierCurveTo(300,142,288,116,268,118);
        c.lineTo(252,152);
        c.bezierCurveTo(232,104,206,110,180,134);
        c.lineTo(168,110);
        c.bezierCurveTo(140,128,110,146,98,150);
        c.lineTo(96,198); c.lineTo(80,244);
        c.closePath();
      },{gx:150,gy:112,gr:54,strands:[[82,238],[150,150],[262,146],[318,230]]});
  }},
  {n:"ツンツン", front(c,P){
      hairFill(c,P,function(c){
        const N=84, seg=N/7;
        for(let i=0;i<=N;i++){
          const a = Math.PI + Math.PI*i/N;
          const f = (i%seg)/seg;
          const k = 1 + 0.20*(1 - Math.abs(2*f-1));
          const x = 200 + 126*k*Math.cos(a), y = 196 + 152*k*Math.sin(a);
          i ? c.lineTo(x,y) : c.moveTo(x,y);
        }
        bangJag(c);
        c.closePath();
      },{gloss:false,strands:[[86,232],[132,168],[264,164],[314,228],[198,150]]});
  }},
  {n:"ぱっつん", front(c,P){
      hairFill(c,P,function(c){
        c.moveTo(62,288); c.lineTo(74,196);
        c.ellipse(200,196,126,152,0,Math.PI,0);
        c.lineTo(338,288); c.lineTo(296,284); c.lineTo(288,186);
        c.lineTo(266,192); c.lineTo(244,178); c.lineTo(222,192);
        c.lineTo(200,176); c.lineTo(178,192); c.lineTo(156,178);
        c.lineTo(134,192); c.lineTo(112,186); c.lineTo(104,284);
        c.closePath();
      },{gx:200,gy:112,gr:78,strands:[[96,250],[150,176],[250,176],[304,250]]});
  }},
  {n:"ロング", back(c,P){
      hairFill(c,P,function(c){
        c.moveTo(52,382); c.bezierCurveTo(40,240,52,44,200,44);
        c.bezierCurveTo(348,44,360,240,348,382);
        c.lineTo(316,340); c.lineTo(300,378); c.lineTo(288,300);
        c.lineTo(112,300); c.lineTo(100,378); c.lineTo(84,340);
        c.closePath();
      },{gloss:false,strands:[[70,330],[130,330],[270,330],[330,330]]});
    }, front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,126,152,0,Math.PI,0);
        c.lineTo(324,286); c.lineTo(300,196);
        c.bezierCurveTo(296,148,268,124,244,130);
        c.lineTo(224,168);
        c.bezierCurveTo(214,132,194,118,174,126);
        c.lineTo(154,164);
        c.bezierCurveTo(142,134,120,130,104,146);
        c.lineTo(100,196); c.lineTo(76,286);
        c.closePath();
      });
  }},
  {n:"ポニーテール", back(c,P){
      hairFill(c,P,function(c){
        c.moveTo(300,156);
        c.bezierCurveTo(360,150,388,216,362,286);
        c.lineTo(376,248); c.lineTo(332,296);
        c.bezierCurveTo(326,238,306,190,300,156);
        c.closePath();
      },{gloss:false,strands:[[338,270],[356,240]]});
      c.beginPath(); c.ellipse(310,152,26,22,0,0,Math.PI*2); fs(c,shade(P.hair,-.2),P.hairline,5);
    }, front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,126,152,0,Math.PI,0);
        bangJag(c);
        c.closePath();
      },{strands:[[80,234],[130,172],[276,152],[318,180]]});
  }},
  {n:"ツインテール", back(c,P){
      [[1,58],[-1,342]].forEach(function(v){
        const d=v[0], ox=v[1];
        hairFill(c,P,function(c){
          c.moveTo(ox+d*30,168);
          c.bezierCurveTo(ox-d*46,182,ox-d*54,266,ox-d*8,314);
          c.lineTo(ox+d*6,278); c.lineTo(ox+d*40,300);
          c.bezierCurveTo(ox+d*34,240,ox+d*32,196,ox+d*30,168);
          c.closePath();
        },{gloss:false,strands:[[ox,280],[ox+d*16,240]]});
        c.beginPath(); c.ellipse(ox+d*24,166,24,20,0,0,Math.PI*2); fs(c,shade(P.hair,-.2),P.hairline,5);
      });
    }, front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,126,152,0,Math.PI,0);
        c.lineTo(318,238); c.lineTo(296,192);
        c.bezierCurveTo(290,146,258,126,230,140);
        c.lineTo(214,170);
        c.bezierCurveTo(204,132,180,120,160,132);
        c.lineTo(146,166);
        c.bezierCurveTo(136,138,118,132,104,148);
        c.lineTo(104,192); c.lineTo(82,238);
        c.closePath();
      },{gx:200,gy:106,gr:70});
  }},
  {n:"アフロ", back(c,P){
      hairFill(c,P,function(c){
        for(let i=0;i<12;i++){
          const a = Math.PI + (Math.PI*1.18/11)*i;
          c.ellipse(200+Math.cos(a)*126, 178+Math.sin(a)*126, 52,52, 0,0,Math.PI*2);
        }
        c.ellipse(200,172,122,124,0,0,Math.PI*2);
      },{gloss:false,strands:[]});
      c.save();
      c.globalAlpha=.3; c.strokeStyle=shade(P.hair,-.45); c.lineWidth=4;
      for(let i=0;i<10;i++){
        const a = Math.PI + (Math.PI*1.18/9)*i;
        c.beginPath();
        c.ellipse(200+Math.cos(a)*112, 178+Math.sin(a)*112, 34,34, 0, 0, Math.PI*2);
        c.stroke();
      }
      c.restore();
    }, front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,196,128,156,0,Math.PI,0);
        c.bezierCurveTo(316,146,272,132,238,148);
        c.bezierCurveTo(208,128,164,132,140,152);
        c.bezierCurveTo(112,140,82,148,72,196);
        c.closePath();
      },{gloss:false,strands:[]});
  }},
  {n:"モヒカン", front(c,P){
      hairFill(c,P,function(c){
        c.moveTo(158,160); c.lineTo(166,72); c.lineTo(184,110); c.lineTo(200,34);
        c.lineTo(216,108); c.lineTo(234,70); c.lineTo(244,162);
        c.bezierCurveTo(224,144,178,144,158,160);
        c.closePath();
      },{gloss:false,strands:[[186,150],[212,150]]});
      c.save(); c.globalAlpha=.55;
      c.beginPath(); c.ellipse(88,196,18,26,0,0,Math.PI*2);
      c.ellipse(312,196,18,26,0,0,Math.PI*2);
      c.restore();
  }},
  {n:"そりこみ", front(c,P){
      hairFill(c,P,function(c){
        c.ellipse(200,192,124,148,0,Math.PI,0);
        c.lineTo(318,236); c.lineTo(302,190);
        c.bezierCurveTo(298,160,276,146,248,152);
        c.lineTo(236,166);
        c.bezierCurveTo(216,146,182,146,160,160);
        c.lineTo(148,146);
        c.bezierCurveTo(124,146,104,156,98,190);
        c.lineTo(82,236);
        c.closePath();
      },{gx:170,gy:118,gr:52,strands:[[92,220],[140,170],[260,168],[312,216]]});
  }},
  {n:"はげ", front(c,P){
      hairFill(c,P,function(c){
        c.moveTo(84,210); c.bezierCurveTo(88,164,104,150,124,148);
        c.lineTo(116,164); c.bezierCurveTo(120,180,106,190,96,216);
        c.closePath();
        c.moveTo(316,210); c.bezierCurveTo(312,164,296,150,276,148);
        c.lineTo(284,164); c.bezierCurveTo(280,180,294,190,304,216);
        c.closePath();
      },{gloss:false,strands:[]});
  }},
  {n:"ギザギザ", front(c,P){
      hairFill(c,P,function(c){
        const N=110, seg=N/11;
        for(let i=0;i<=N;i++){
          const f = (i%seg)/seg;
          const k = 1 + 0.13*(1 - Math.abs(2*f-1));
          const a = Math.PI + Math.PI*i/N;
          const x = 200 + 126*k*Math.cos(a), y = 196 + 152*k*Math.sin(a);
          i ? c.lineTo(x,y) : c.moveTo(x,y);
        }
        c.lineTo(316,246); c.lineTo(302,192);
        c.lineTo(292,138); c.lineTo(278,182); c.lineTo(262,130);
        c.lineTo(246,178); c.lineTo(230,124); c.lineTo(214,174);
        c.lineTo(198,120); c.lineTo(182,174); c.lineTo(166,124);
        c.lineTo(150,178); c.lineTo(134,132); c.lineTo(120,182);
        c.lineTo(106,140); c.lineTo(98,192); c.lineTo(84,246);
        c.closePath();
      },{gloss:false,strands:[[86,232],[136,178],[264,174],[314,228],[198,160]]});
  }},
  {n:"逆立て", front(c,P){
      hairFill(c,P,function(c){
        const N=100, seg=N/5;
        for(let i=0;i<=N;i++){
          const f = (i%seg)/seg;
          const t = 1 - Math.abs(2*f-1);
          const k = 1 + 0.36*t*t;
          const a = Math.PI + Math.PI*i/N - 0.12*t*t;
          const x = 200 + 126*k*Math.cos(a), y = 196 + 152*k*Math.sin(a);
          i ? c.lineTo(x,y) : c.moveTo(x,y);
        }
        c.lineTo(316,242); c.lineTo(300,190);
        c.lineTo(288,136); c.lineTo(270,180); c.lineTo(250,126);
        c.lineTo(228,176); c.lineTo(206,118); c.lineTo(184,176);
        c.lineTo(162,126); c.lineTo(140,180); c.lineTo(120,134);
        c.lineTo(100,190); c.lineTo(84,242);
        c.closePath();
      },{gloss:false,strands:[[88,230],[140,176],[262,172],[312,226]]});
  }},
  {n:"ウルフ", back(c,P){
      hairFill(c,P,function(c){
        c.moveTo(54,338); c.bezierCurveTo(42,220,54,46,200,46);
        c.bezierCurveTo(346,46,358,220,346,338);
        c.lineTo(330,284); c.lineTo(314,350); c.lineTo(298,282);
        c.lineTo(282,328); c.lineTo(272,268);
        c.lineTo(128,268); c.lineTo(118,328);
        c.lineTo(102,282); c.lineTo(86,350); c.lineTo(70,284);
        c.closePath();
      },{gloss:false,strands:[[78,312],[136,296],[264,296],[322,312]]});
    }, front(c,P){
      hairFill(c,P,function(c){
        const N=98, seg=N/7;
        for(let i=0;i<=N;i++){
          const f = (i%seg)/seg;
          const k = 1 + 0.17*(1 - Math.abs(2*f-1));
          const a = Math.PI + Math.PI*i/N;
          const x = 200 + 126*k*Math.cos(a), y = 196 + 152*k*Math.sin(a);
          i ? c.lineTo(x,y) : c.moveTo(x,y);
        }
        c.lineTo(322,290); c.lineTo(302,192);
        c.lineTo(290,140); c.lineTo(272,180); c.lineTo(254,128);
        c.lineTo(234,176); c.lineTo(212,122); c.lineTo(190,176);
        c.lineTo(168,128); c.lineTo(146,180); c.lineTo(124,136);
        c.lineTo(100,192); c.lineTo(78,290);
        c.closePath();
      },{gloss:false,strands:[[88,236],[138,178],[262,174],[312,232]]});
  }}
];


function eyePair(c: Ctx, p: Palette, draw: (c: Ctx, p: Palette, side?: number) => void): void {
  const P = p;
  const gap = EYE_DX + P.eyegap, y = EYE_Y + P.eyey, k = 0.82;
  c.save(); c.translate(200-gap,y); c.scale(k,k); draw(c,P,-1); c.restore();
  c.save(); c.translate(200+gap,y); c.scale(-k,k); draw(c,P,1); c.restore();
}

const EYES: PartDef[] = [
  {n:"まる", d(c,P){
    c.beginPath(); c.ellipse(0,0,22,26,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(1,3,12,15,0,0,Math.PI*2); fs(c,P.eye,null);
    c.beginPath(); c.ellipse(-4,-5,5,6,0,0,Math.PI*2); fs(c,"#ffffff",null);
  }},
  {n:"てん", d(c,P){
    c.beginPath(); c.ellipse(0,0,9,11,0,0,Math.PI*2); fs(c,P.eye,null);
  }},
  {n:"いとめ", d(c,P){
    c.beginPath(); c.moveTo(-22,4); c.quadraticCurveTo(0,-16,22,2); fs(c,null,P.eye,7);
  }},
  {n:"たれめ", d(c,P){
    c.beginPath(); c.ellipse(0,2,22,24,0.28,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(-2,7,11,13,0,0,Math.PI*2); fs(c,P.eye,null);
    c.beginPath(); c.ellipse(-6,0,4,5,0,0,Math.PI*2); fs(c,"#ffffff",null);
  }},
  {n:"つりめ", d(c,P){
    c.beginPath(); c.ellipse(0,0,22,22,-0.3,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(2,1,11,13,0,0,Math.PI*2); fs(c,P.eye,null);
    c.beginPath(); c.ellipse(-2,-5,4,5,0,0,Math.PI*2); fs(c,"#ffffff",null);
  }},
  {n:"キラキラ", d(c,P){
    c.beginPath(); c.ellipse(0,0,25,29,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(1,3,16,19,0,0,Math.PI*2); fs(c,P.eye,null);
    c.beginPath(); c.ellipse(-6,-7,7,8,0,0,Math.PI*2); fs(c,"#ffffff",null);
    c.beginPath(); c.ellipse(7,10,4,4,0,0,Math.PI*2); fs(c,"#ffffff",null);
  }},
  {n:"びっくり", d(c,P){
    c.beginPath(); c.ellipse(0,0,26,28,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(0,2,8,9,0,0,Math.PI*2); fs(c,P.eye,null);
  }},
  {n:"ジト目", d(c,P){
    c.beginPath(); c.ellipse(0,2,22,20,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath(); c.ellipse(0,6,11,12,0,0,Math.PI*2); fs(c,P.eye,null);
    c.beginPath(); c.moveTo(-24,-4); c.lineTo(24,-4); fs(c,null,P.line,10);
  }},
  {n:"にっこり", d(c,P){
    c.beginPath(); c.moveTo(-20,4); c.quadraticCurveTo(0,-20,20,4); fs(c,null,P.eye,7);
  }},
  {n:"ぐるぐる", d(c,P){
    c.beginPath(); c.ellipse(0,0,23,25,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath();
    for(let i=0;i<=60;i++){ const a=i/60*Math.PI*4, r=2+i*0.28; const x=Math.cos(a)*r,y=Math.sin(a)*r; i?c.lineTo(x,y):c.moveTo(x,y); }
    fs(c,null,P.eye,4);
  }},
  {n:"ハート", d(c,P){
    c.beginPath(); c.ellipse(0,0,23,26,0,0,Math.PI*2); fs(c,"#ffffff",P.line,5);
    c.beginPath();
    c.moveTo(0,14); c.bezierCurveTo(-18,2,-14,-12,-4,-10); c.bezierCurveTo(-1,-9,0,-6,0,-4);
    c.bezierCurveTo(0,-6,1,-9,4,-10); c.bezierCurveTo(14,-12,18,2,0,14);
    fs(c,P.eye,null);
  }}
];


const BROWS: PartDef[] = [
  {n:"なし", d(){}},
  {n:"ふつう", d(c,P){ c.beginPath(); c.moveTo(-24,4); c.quadraticCurveTo(0,-8,24,0); fs(c,null,P.brow,10); }},
  {n:"ふとまゆ", d(c,P){ c.beginPath(); c.moveTo(-26,4); c.quadraticCurveTo(0,-12,26,2); fs(c,null,P.brow,17); }},
  {n:"こまり", d(c,P){ c.beginPath(); c.moveTo(-24,8); c.quadraticCurveTo(0,-2,24,-8); fs(c,null,P.brow,10); }},
  {n:"おこり", d(c,P){ c.beginPath(); c.moveTo(-24,-4); c.quadraticCurveTo(0,2,24,10); fs(c,null,P.brow,12); }},
  {n:"逆ハの字", d(c,P){ c.beginPath(); c.moveTo(-24,-8); c.quadraticCurveTo(0,2,24,8); fs(c,null,P.brow,12); }},
  {n:"ほそまゆ", d(c,P){ c.beginPath(); c.moveTo(-22,4); c.quadraticCurveTo(0,-10,22,0); fs(c,null,P.brow,5); }},
  {n:"まっすぐ", d(c,P){ c.beginPath(); c.moveTo(-24,0); c.lineTo(24,0); fs(c,null,P.brow,11); }},
  {n:"ギザギザ", d(c,P){ c.beginPath(); c.moveTo(-24,6); c.lineTo(-8,-6); c.lineTo(6,4); c.lineTo(24,-8); fs(c,null,P.brow,10); }}
];


const NOSES: PartDef[] = [
  {n:"なし", d(){}},
  {n:"てん", d(c,P){ c.beginPath(); c.ellipse(200,NOSE_Y,7,7,0,0,Math.PI*2); fs(c,P.line,null); }},
  {n:"くの字", d(c,P){ c.beginPath(); c.moveTo(196,NOSE_Y-10); c.lineTo(206,NOSE_Y+2); c.lineTo(194,NOSE_Y+4); fs(c,null,P.line,6); }},
  {n:"さんかく", d(c,P){ c.beginPath(); c.moveTo(200,NOSE_Y-11); c.lineTo(211,NOSE_Y+5); c.lineTo(189,NOSE_Y+5); c.closePath(); fs(c,P.line,null); }},
  {n:"まる", d(c,P){ c.beginPath(); c.ellipse(200,NOSE_Y,13,11,0,0,Math.PI*2); fs(c,P.blush,P.line,5); }},
  {n:"よこ線", d(c,P){ c.beginPath(); c.moveTo(190,NOSE_Y); c.lineTo(210,NOSE_Y); fs(c,null,P.line,6); }}
];


const MOUTHS: PartDef[] = [
  {n:"ふつう", d(c,P){ c.beginPath(); c.moveTo(-16,0); c.quadraticCurveTo(0,12,16,0); fs(c,null,P.line,7); }},
  {n:"にっこり", d(c,P){ c.beginPath(); c.moveTo(-30,-6); c.quadraticCurveTo(0,26,30,-6); fs(c,null,P.line,8); }},
  {n:"への字", d(c,P){ c.beginPath(); c.moveTo(-24,8); c.quadraticCurveTo(0,-10,24,8); fs(c,null,P.line,8); }},
  {n:"あんぐり", d(c,P){
    c.beginPath(); c.ellipse(0,4,26,22,0,0,Math.PI*2); fs(c,P.mouth,P.line,6);
    c.beginPath(); c.ellipse(0,18,14,8,0,0,Math.PI*2); fs(c,"#ff9aa0",null);
  }},
  {n:"にかっ", d(c,P){
    c.beginPath(); c.moveTo(-32,-4); c.quadraticCurveTo(0,32,32,-4); c.closePath(); fs(c,P.mouth,P.line,6);
    c.beginPath(); c.moveTo(-27,-1); c.lineTo(27,-1); fs(c,null,"#ffffff",8);
  }},
  {n:"ちいさい丸", d(c,P){ c.beginPath(); c.ellipse(0,2,11,12,0,0,Math.PI*2); fs(c,P.mouth,P.line,5); }},
  {n:"ギザギザ", d(c,P){
    c.beginPath(); c.moveTo(-28,-2); c.lineTo(-16,12); c.lineTo(-4,-2); c.lineTo(8,12); c.lineTo(20,-2); c.lineTo(30,8);
    fs(c,null,P.line,7);
  }},
  {n:"いちもんじ", d(c,P){ c.beginPath(); c.moveTo(-20,2); c.lineTo(20,2); fs(c,null,P.line,8); }},
  {n:"べー", d(c,P){
    c.beginPath(); c.moveTo(-22,-2); c.quadraticCurveTo(0,16,22,-2); c.closePath(); fs(c,P.mouth,P.line,6);
    c.beginPath(); c.ellipse(0,14,13,12,0,0,Math.PI*2); fs(c,"#ff8f96",P.line,5);
  }},
  {n:"ニヤリ", d(c,P){ c.beginPath(); c.moveTo(-26,-2); c.quadraticCurveTo(6,20,28,-10); fs(c,null,P.line,8); }}
];


const BEARDS: PartDef[] = [
  {n:"なし", d(){}},
  {n:"口ヒゲ", d(c,P){
    c.beginPath();
    c.moveTo(200,MOUTH_Y-22); c.bezierCurveTo(178,MOUTH_Y-34,156,MOUTH_Y-28,152,MOUTH_Y-14);
    c.bezierCurveTo(170,MOUTH_Y-20,190,MOUTH_Y-16,200,MOUTH_Y-10);
    c.bezierCurveTo(210,MOUTH_Y-16,230,MOUTH_Y-20,248,MOUTH_Y-14);
    c.bezierCurveTo(244,MOUTH_Y-28,222,MOUTH_Y-34,200,MOUTH_Y-22);
    fs(c,P.beard,null);
  }},
  {n:"あごヒゲ", d(c,P){
    c.beginPath(); c.ellipse(200,MOUTH_Y+26,16,20,0,0,Math.PI*2); fs(c,P.beard,null);
  }},
  {n:"無精ヒゲ", d(c,P){
    c.save();
    headPath(c,P.head); c.clip();
    c.globalAlpha = .55;
    c.beginPath(); c.ellipse(200,MOUTH_Y+4,74,52,0,0,Math.PI*2); fs(c,P.beard,null);
    c.restore();
  }},
  {n:"フルビアード", d(c,P){
    c.save(); headPath(c,P.head); c.clip();
    c.beginPath(); c.ellipse(200,MOUTH_Y+18,88,72,0,0,Math.PI*2); fs(c,P.beard,null);
    c.restore();
    c.beginPath(); c.ellipse(200,MOUTH_Y,30,16,0,0,Math.PI*2); fs(c,P.mouth,null);
  }},
  {n:"もみあげ", d(c,P){
    c.save(); headPath(c,P.head); c.clip();
    c.beginPath(); rr(c,84,168,24,72,10); fs(c,P.beard,null);
    c.beginPath(); rr(c,292,168,24,72,10); fs(c,P.beard,null);
    c.restore();
  }}
];


function torso(c: Ctx): void {
  c.beginPath();
  c.moveTo(52,400);
  c.bezierCurveTo(56,340,108,306,152,296);
  c.lineTo(248,296);
  c.bezierCurveTo(292,306,344,340,348,400);
  c.closePath();
}

const BODIES: PartDef[] = [
  {n:"なし", d(){}},
  {n:"野球ユニフォーム", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath();
    c.moveTo(152,296); c.lineTo(200,344); c.lineTo(248,296);
    c.lineTo(228,294); c.lineTo(200,322); c.lineTo(172,294); c.closePath();
    fs(c,P.cloth2,null);
    c.beginPath(); c.moveTo(200,344); c.lineTo(200,400); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(60,398); c.lineTo(74,352); fs(c,null,P.cloth2,10);
    c.beginPath(); c.moveTo(340,398); c.lineTo(326,352); fs(c,null,P.cloth2,10);
  }},
  {n:"Tシャツ", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); c.moveTo(166,298); c.quadraticCurveTo(200,326,234,298); fs(c,null,P.line,5);
    c.beginPath(); c.ellipse(200,368,40,28,0,0,Math.PI*2); fs(c,P.cloth2,null);
  }},
  {n:"スーツ", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); c.moveTo(168,296); c.lineTo(200,400); c.lineTo(232,296); c.closePath(); fs(c,"#f6f4ee",P.line,4);
    c.beginPath(); c.moveTo(200,312); c.lineTo(186,330); c.lineTo(200,346); c.lineTo(214,330); c.closePath(); fs(c,P.cloth2,null);
    c.beginPath(); c.moveTo(200,346); c.lineTo(190,400); c.lineTo(212,400); c.closePath(); fs(c,P.cloth2,null);
    c.beginPath(); c.moveTo(166,298); c.lineTo(140,400); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(234,298); c.lineTo(260,400); fs(c,null,P.line,4);
  }},
  {n:"パーカー", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); c.moveTo(140,300); c.quadraticCurveTo(200,356,260,300); c.lineTo(248,294); c.lineTo(152,294); c.closePath();
    fs(c,P.cloth2,P.line,4);
    c.beginPath(); c.moveTo(186,336); c.lineTo(182,382); fs(c,null,P.line,5);
    c.beginPath(); c.moveTo(214,336); c.lineTo(218,382); fs(c,null,P.line,5);
  }},
  {n:"学ラン", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); rr(c,160,288,80,26,8); fs(c,"#ffffff",P.line,4);
    c.beginPath(); c.moveTo(200,314); c.lineTo(200,400); fs(c,null,P.line,4);
    [340,368,394].forEach(function(y){ c.beginPath(); c.ellipse(214,y,6,6,0,0,Math.PI*2); fs(c,P.cloth2,null); });
  }},
  {n:"白衣", d(c,P){
    torso(c); fs(c,"#f3f5f7",P.line);
    c.beginPath(); c.moveTo(170,296); c.lineTo(200,352); c.lineTo(230,296); c.closePath(); fs(c,P.cloth2,P.line,4);
    c.beginPath(); rr(c,262,344,46,40,6); fs(c,null,P.line,4);
  }},
  {n:"セーラー", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath();
    c.moveTo(150,296); c.lineTo(120,368); c.lineTo(200,344); c.lineTo(280,368); c.lineTo(250,296); c.closePath();
    fs(c,P.cloth2,P.line,4);
    c.beginPath(); c.moveTo(200,344); c.lineTo(186,390); c.lineTo(214,390); c.closePath(); fs(c,"#e2454f",null);
  }},
  {n:"よろい", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); c.ellipse(96,336,52,40,0,0,Math.PI*2); fs(c,P.cloth2,P.line,5);
    c.beginPath(); c.ellipse(304,336,52,40,0,0,Math.PI*2); fs(c,P.cloth2,P.line,5);
    c.beginPath(); c.moveTo(200,300); c.lineTo(200,400); fs(c,null,P.line,5);
    c.beginPath(); c.moveTo(160,352); c.lineTo(240,352); fs(c,null,P.line,5);
  }},
  {n:"はだか", d(c,P){
    torso(c); fs(c,P.skin,P.line);
    c.beginPath(); c.moveTo(200,320); c.lineTo(200,376); fs(c,null,P.line,4);
  }},
  {n:"縦じまユニフォーム", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.save(); torso(c); c.clip();
    c.strokeStyle=P.cloth2; c.lineWidth=5;
    for(let x=64;x<348;x+=24){ c.beginPath(); c.moveTo(x,288); c.lineTo(x,400); c.stroke(); }
    c.restore();
    c.beginPath(); c.moveTo(176,292); c.lineTo(200,336); c.lineTo(224,292); c.closePath(); fs(c,P.cloth2,P.line,4);
    c.beginPath(); rr(c,190,336,20,64,6); fs(c,P.cloth1,P.line,4);
  }},
  {n:"ラグラン袖", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.save(); torso(c); c.clip();
    c.beginPath(); c.moveTo(150,288); c.bezierCurveTo(104,308,60,344,52,400); c.lineTo(120,400);
    c.bezierCurveTo(120,344,140,310,166,292); c.closePath(); fs(c,P.cloth2,null);
    c.beginPath(); c.moveTo(250,288); c.bezierCurveTo(296,308,340,344,348,400); c.lineTo(280,400);
    c.bezierCurveTo(280,344,260,310,234,292); c.closePath(); fs(c,P.cloth2,null);
    c.restore();
    c.beginPath(); c.moveTo(172,292); c.lineTo(200,330); c.lineTo(228,292); c.closePath(); fs(c,P.cloth2,P.line,4);
    c.beginPath(); c.moveTo(200,330); c.lineTo(200,400); fs(c,null,P.line,4);
  }},
  {n:"キャッチャー防具", d(c,P){
    torso(c); fs(c,P.cloth1,P.line);
    c.beginPath(); rr(c,120,296,160,50,18); fs(c,P.cloth2,P.line,5);
    c.beginPath(); rr(c,112,352,176,48,18); fs(c,P.cloth2,P.line,5);
    c.beginPath(); c.moveTo(200,296); c.lineTo(200,400); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(148,292); c.lineTo(128,272); fs(c,null,P.line,6);
    c.beginPath(); c.moveTo(252,292); c.lineTo(272,272); fs(c,null,P.line,6);
  }},
  {n:"アンダーシャツ", d(c,P){
    torso(c); fs(c,P.cloth2,P.line);
    c.save(); torso(c); c.clip();
    c.beginPath(); c.moveTo(148,290); c.lineTo(252,290); c.lineTo(252,400); c.lineTo(148,400); c.closePath();
    fs(c,P.cloth1,null);
    c.restore();
    c.beginPath(); c.moveTo(148,290); c.lineTo(148,400); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(252,290); c.lineTo(252,400); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(174,292); c.quadraticCurveTo(200,322,226,292); fs(c,null,P.line,5);
  }}
];


function ballStitch(c: Ctx, x: number, y: number, r: number, col: string): void {
  c.beginPath(); c.ellipse(x,y,r,r,0,0,Math.PI*2); fs(c,"#ffffff","#2b2b2b",3);
  c.beginPath(); c.moveTo(x-r*0.55,y-r*0.8); c.quadraticCurveTo(x-r*0.05,y,x-r*0.55,y+r*0.8); fs(c,null,col,3);
  c.beginPath(); c.moveTo(x+r*0.55,y-r*0.8); c.quadraticCurveTo(x+r*0.05,y,x+r*0.55,y+r*0.8); fs(c,null,col,3);
}


const ITEMS: PartDef[] = [
  {n:"なし", d(){}},
  {n:"バット", d(c,P){
    c.save(); c.translate(326,300); c.rotate(-0.24);
    c.beginPath(); rr(c,-19,-206,38,150,19); fs(c,P.item,P.line,5);
    c.beginPath(); rr(c,-11,-70,22,74,10); fs(c,P.item,P.line,5);
    c.beginPath(); c.ellipse(0,10,17,12,0,0,Math.PI*2); fs(c,P.item,P.line,5);
    c.restore();
  }},
  {n:"グローブ", d(c,P){
    c.save(); c.translate(76,336);
    c.beginPath(); c.ellipse(0,0,52,56,0.2,0,Math.PI*2); fs(c,P.item,P.line,5);
    c.beginPath(); c.ellipse(-30,-26,18,30,0.5,0,Math.PI*2); fs(c,P.item,P.line,5);
    c.beginPath(); c.moveTo(-16,-6); c.lineTo(24,-10); fs(c,null,P.line,4);
    c.beginPath(); c.moveTo(-16,14); c.lineTo(24,12); fs(c,null,P.line,4);
    c.restore();
  }},
  {n:"ボール", d(c){ ballStitch(c,338,340,30,"#d53b3b"); }},
  {n:"バットとボール", d(c,P){
    ITEMS[1].d(c,P); ballStitch(c,70,340,30,"#d53b3b");
  }},
  {n:"グローブとボール", d(c,P){
    ITEMS[2].d(c,P); ballStitch(c,336,344,28,"#d53b3b");
  }}
];


const HATS: HatDef[] = [
  {n:"なし", d(){}, textY:132},
  {n:"野球帽", d(c,P){
    c.beginPath();
    c.ellipse(200,158,118,118,0,Math.PI,0); c.closePath();
    fs(c,P.hat1,P.line);
    c.beginPath(); c.ellipse(200,160,126,26,0,0,Math.PI); fs(c,P.hat2,P.line);
    c.beginPath(); c.ellipse(200,42,10,10,0,0,Math.PI*2); fs(c,P.hat2,P.line,4);
  }, textY:112},
  {n:"ニット帽", d(c,P){
    c.beginPath();
    c.ellipse(200,148,114,114,0,Math.PI,0); c.closePath();
    fs(c,P.hat1,P.line);
    c.beginPath(); rr(c,86,132,228,38,14); fs(c,P.hat2,P.line);
    c.beginPath(); c.ellipse(200,22,22,20,0,0,Math.PI*2); fs(c,P.hat2,P.line);
  }, textY:104},
  {n:"ヘッドホン", d(c,P){
    c.beginPath(); c.ellipse(200,168,134,120,0,Math.PI*1.08,Math.PI*1.92); fs(c,null,P.hat1,18);
    c.beginPath(); rr(c,50,158,46,74,16); fs(c,P.hat2,P.line,5);
    c.beginPath(); rr(c,304,158,46,74,16); fs(c,P.hat2,P.line,5);
  }, textY:132},
  {n:"リボン", d(c,P){
    c.beginPath(); c.moveTo(248,86); c.lineTo(196,60); c.lineTo(200,120); c.closePath(); fs(c,P.hat1,P.line,5);
    c.beginPath(); c.moveTo(252,86); c.lineTo(304,60); c.lineTo(300,120); c.closePath(); fs(c,P.hat1,P.line,5);
    c.beginPath(); c.ellipse(250,90,14,14,0,0,Math.PI*2); fs(c,P.hat2,P.line,5);
  }, textY:150},
  {n:"ハチマキ", d(c,P){
    c.beginPath(); rr(c,72,132,256,34,8); fs(c,P.hat1,P.line,5);
    c.beginPath(); c.ellipse(200,150,16,16,0,0,Math.PI*2); fs(c,P.hat2,P.line,4);
    c.beginPath(); c.moveTo(72,148); c.lineTo(26,186); c.lineTo(44,200); c.lineTo(76,166); c.closePath(); fs(c,P.hat1,P.line,5);
  }, textY:150},
  {n:"王冠", d(c,P){
    c.beginPath();
    c.moveTo(104,134); c.lineTo(116,56); c.lineTo(158,106); c.lineTo(200,42);
    c.lineTo(242,106); c.lineTo(284,56); c.lineTo(296,134); c.closePath();
    fs(c,P.hat1,P.line,5);
    c.beginPath(); rr(c,102,128,196,26,8); fs(c,P.hat2,P.line,5);
  }, textY:172},
  {n:"ヘルメット", d(c,P){
    c.beginPath(); c.ellipse(200,160,120,122,0,Math.PI,0); c.closePath(); fs(c,P.hat1,P.line);
    c.beginPath(); c.moveTo(82,160); c.lineTo(318,160); fs(c,null,P.line,5);
    c.beginPath(); c.ellipse(200,162,132,26,0,0,Math.PI*0.55); fs(c,P.hat2,P.line,5);
    c.beginPath(); rr(c,190,40,20,118,10); fs(c,P.hat2,null);
  }, textY:112},
  {n:"打者ヘルメット", d(c,P){
    c.beginPath();
    c.moveTo(100,136); c.bezierCurveTo(50,150,50,222,90,242);
    c.bezierCurveTo(118,220,114,162,100,136); c.closePath();
    fs(c,P.hat1,P.line,5);
    c.beginPath(); c.ellipse(200,160,120,122,0,Math.PI,0); c.closePath(); fs(c,P.hat1,P.line);
    c.beginPath(); c.ellipse(200,160,128,26,0,0,Math.PI); fs(c,P.hat1,P.line);
    c.beginPath(); c.moveTo(200,40); c.lineTo(200,156); fs(c,null,P.hat2,9);
    c.beginPath(); c.moveTo(88,156); c.bezierCurveTo(140,130,260,130,312,156); fs(c,null,P.hat2,7);
  }, textY:110},
  {n:"キャッチャーマスク", d(c,P){
    c.beginPath(); c.ellipse(200,162,120,122,0,Math.PI,0); c.closePath(); fs(c,P.hat1,P.line);
    c.save();
    c.beginPath(); rr(c,86,150,228,150,40); c.clip();
    c.strokeStyle=P.hat2; c.lineWidth=9; c.lineCap="round";
    for(let x=110;x<=290;x+=36){ c.beginPath(); c.moveTo(x,146); c.lineTo(x,304); c.stroke(); }
    for(let y=176;y<=290;y+=38){ c.beginPath(); c.moveTo(82,y); c.lineTo(318,y); c.stroke(); }
    c.restore();
    c.beginPath(); rr(c,86,150,228,150,40); fs(c,null,P.line,7);
    c.beginPath(); rr(c,70,196,26,70,12); fs(c,P.hat2,P.line,5);
    c.beginPath(); rr(c,304,196,26,70,12); fs(c,P.hat2,P.line,5);
  }, textY:112},
  {n:"帽子＋サングラス", d(c,P){
    c.beginPath(); c.ellipse(200,158,118,118,0,Math.PI,0); c.closePath(); fs(c,P.hat1,P.line);
    c.beginPath(); c.ellipse(200,160,126,26,0,0,Math.PI); fs(c,P.hat2,P.line);
    c.beginPath();
    c.moveTo(104,146); c.lineTo(296,146); c.lineTo(288,116); c.quadraticCurveTo(200,98,112,116); c.closePath();
    fs(c,"#2b3a4a",P.line,5);
  }, textY:76},
  {n:"帽子（後ろ向き）", d(c,P){
    c.beginPath(); c.ellipse(200,158,118,118,0,Math.PI,0); c.closePath(); fs(c,P.hat1,P.line);
    c.beginPath(); rr(c,86,134,228,28,10); fs(c,P.hat2,P.line,5);
    c.beginPath(); rr(c,180,134,40,22,6); fs(c,P.hat1,P.line,4);
    c.beginPath(); c.moveTo(88,126); c.lineTo(60,140); c.lineTo(90,148); c.closePath(); fs(c,P.hat2,P.line,4);
    c.beginPath(); c.moveTo(312,126); c.lineTo(340,140); c.lineTo(310,148); c.closePath(); fs(c,P.hat2,P.line,4);
  }, textY:106}
];


const GLASSES: PartDef[] = [
  {n:"なし", d(){}},
  {n:"まるメガネ", d(c,P){
    const g = EYE_DX + P.eyegap, y = EYE_Y + P.eyey;
    [200-g,200+g].forEach(function(x){
      c.beginPath(); c.ellipse(x,y,34,34,0,0,Math.PI*2);
      c.save(); c.globalAlpha = P.lens/100; fs(c,P.lensColor,null); c.restore();
      fs(c,null,P.glass,7);
    });
    c.beginPath(); c.moveTo(200-g+34,y); c.lineTo(200+g-34,y); fs(c,null,P.glass,7);
    c.beginPath(); c.moveTo(200-g-34,y); c.lineTo(84,y-6); fs(c,null,P.glass,7);
    c.beginPath(); c.moveTo(200+g+34,y); c.lineTo(316,y-6); fs(c,null,P.glass,7);
  }},
  {n:"しかくメガネ", d(c,P){
    const g = EYE_DX + P.eyegap, y = EYE_Y + P.eyey;
    [200-g,200+g].forEach(function(x){
      c.beginPath(); rr(c,x-38,y-26,76,52,10);
      c.save(); c.globalAlpha = P.lens/100; fs(c,P.lensColor,null); c.restore();
      fs(c,null,P.glass,7);
    });
    c.beginPath(); c.moveTo(200-g+38,y); c.lineTo(200+g-38,y); fs(c,null,P.glass,7);
    c.beginPath(); c.moveTo(200-g-38,y-10); c.lineTo(84,y-14); fs(c,null,P.glass,7);
    c.beginPath(); c.moveTo(200+g+38,y-10); c.lineTo(316,y-14); fs(c,null,P.glass,7);
  }},
  {n:"スポーツ", d(c,P){
    const y = EYE_Y + P.eyey;
    c.beginPath();
    c.moveTo(82,y-24); c.lineTo(318,y-24); c.lineTo(310,y+22);
    c.quadraticCurveTo(200,y+42,90,y+22); c.closePath();
    c.save(); c.globalAlpha = Math.max(.25,P.lens/100); fs(c,P.lensColor,null); c.restore();
    fs(c,null,P.glass,7);
  }},
  {n:"片メガネ", d(c,P){
    const g = EYE_DX + P.eyegap, y = EYE_Y + P.eyey, x = 200+g;
    c.beginPath(); c.ellipse(x,y,36,36,0,0,Math.PI*2);
    c.save(); c.globalAlpha = P.lens/100; fs(c,P.lensColor,null); c.restore();
    fs(c,null,P.glass,7);
    c.beginPath(); c.moveTo(x+36,y+10); c.quadraticCurveTo(330,y+60,306,y+96); fs(c,null,P.glass,5);
  }}
];


const EXTRAS: PartDef[] = [
  {n:"なし", d(){}},
  {n:"ほお染め", d(c,P){
    const y = EYE_Y + P.eyey + 42;
    c.save(); headPath(c,P.head); c.clip(); c.globalAlpha=.75;
    c.beginPath(); c.ellipse(118,y,30,18,0,0,Math.PI*2); fs(c,P.extra,null);
    c.beginPath(); c.ellipse(282,y,30,18,0,0,Math.PI*2); fs(c,P.extra,null);
    c.restore();
  }},
  {n:"あせ", d(c,P){
    c.beginPath();
    c.moveTo(304,96); c.bezierCurveTo(288,126,286,146,304,150); c.bezierCurveTo(322,146,320,126,304,96);
    fs(c,P.extra,P.line,4);
  }},
  {n:"なみだ", d(c,P){
    const g = EYE_DX + P.eyegap, y = EYE_Y + P.eyey + 26;
    [200-g,200+g].forEach(function(x){
      c.beginPath(); c.moveTo(x,y); c.bezierCurveTo(x-13,y+34,x-8,y+56,x,y+56); c.bezierCurveTo(x+8,y+56,x+13,y+34,x,y);
      fs(c,P.extra,P.line,4);
    });
  }},
  {n:"いかり", d(c,P){
    c.save(); c.translate(300,92); c.scale(1.5,1.5);
    [[-12,-6,12,-6],[-14,6,10,6],[-6,-14,-10,14],[8,-14,4,14]].forEach(function(v){
      c.beginPath(); c.moveTo(v[0],v[1]); c.lineTo(v[2],v[3]); fs(c,null,P.extra,5);
    });
    c.restore();
  }},
  {n:"キラ星", d(c,P){
    [[74,88,22],[330,124,15],[92,250,12]].forEach(function(s){
      c.save(); c.translate(s[0],s[1]);
      c.beginPath();
      for(let i=0;i<8;i++){ const a=i/8*Math.PI*2, r=(i%2?s[2]*0.34:s[2]); const x=Math.cos(a)*r,y=Math.sin(a)*r; i?c.lineTo(x,y):c.moveTo(x,y); }
      c.closePath(); fs(c,P.extra,null); c.restore();
    });
  }},
  {n:"アイブラック", d(c,P){
    const g = EYE_DX + P.eyegap, y = EYE_Y + P.eyey + 30;
    [200-g,200+g].forEach(function(x){
      c.beginPath(); rr(c,x-19,y,38,12,5); fs(c,"#25201d",null);
    });
  }},
  {n:"しずく（青ざめ）", d(c,P){
    c.save(); headPath(c,P.head); c.clip();
    c.beginPath(); c.moveTo(240,52); c.lineTo(300,52); c.lineTo(300,112); c.closePath();
    c.globalAlpha=.8; fs(c,"#7fd2f5",null); c.restore();
    c.beginPath(); c.moveTo(246,56); c.lineTo(246,102); fs(c,null,"#4fa9d6",5);
    c.beginPath(); c.moveTo(266,56); c.lineTo(266,88); fs(c,null,"#4fa9d6",5);
  }}
];


export const BGS: readonly string[] = ["ベタ塗り","放射線","円形グラデ","ストライプ","ドット","透明","グラウンド","ナイター"];

function toPalette(a: PlayerAppearance): Palette {
  return {
    head: a.head,
    skin: a.skinColor,
    line: a.lineColor,
    blush: a.blushColor,
    hair: a.hairColor,
    hairline: a.hairLineColor,
    eye: a.eyeColor,
    brow: a.browColor,
    mouth: a.mouthColor,
    beard: a.beardColor,
    cloth1: a.cloth1Color,
    cloth2: a.cloth2Color,
    hat1: a.hat1Color,
    hat2: a.hat2Color,
    glass: a.glassColor,
    lensColor: a.lensColor,
    lens: a.lensOpacity,
    extra: a.extraColor,
    item: a.itemColor,
    eyegap: a.eyeGapOffset,
    eyey: a.eyeYOffset,
  };
}

function drawBg(c: Ctx, bg: number, bg1: string, bg2: string): void {
  if (bg === 5) return;
  if (bg === 0) {
    c.fillStyle = bg1; c.fillRect(0, 0, V, V);
  } else if (bg === 1) {
    c.fillStyle = bg1; c.fillRect(0, 0, V, V);
    const n = 24, step = (Math.PI * 2) / n;
    c.fillStyle = bg2;
    for (let i = 0; i < n; i += 2) {
      c.beginPath(); c.moveTo(200, 200); c.arc(200, 200, 420, i * step, (i + 1) * step); c.closePath(); c.fill();
    }
  } else if (bg === 2) {
    const g = c.createRadialGradient(200, 180, 20, 200, 200, 300);
    g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    c.fillStyle = g; c.fillRect(0, 0, V, V);
  } else if (bg === 3) {
    c.fillStyle = bg1; c.fillRect(0, 0, V, V);
    c.save(); c.fillStyle = bg2; c.translate(200, 200); c.rotate(-Math.PI / 4); c.translate(-300, -300);
    for (let x = 0; x < 600; x += 56) c.fillRect(x, 0, 28, 600);
    c.restore();
  } else if (bg === 4) {
    c.fillStyle = bg1; c.fillRect(0, 0, V, V);
    c.fillStyle = bg2;
    for (let y = 20; y < V; y += 44) {
      for (let x = (y / 44) % 2 ? 42 : 20; x < V; x += 44) {
        c.beginPath(); c.ellipse(x, y, 11, 11, 0, 0, Math.PI * 2); c.fill();
      }
    }
  } else if (bg === 6) {
    c.fillStyle = bg1; c.fillRect(0, 0, V, 168);
    c.fillStyle = "#1d3b2a"; c.fillRect(0, 148, V, 26);
    c.fillStyle = bg2; c.fillRect(0, 170, V, V - 170);
    c.save(); c.beginPath(); c.rect(0, 170, V, V - 170); c.clip();
    c.globalAlpha = 0.22; c.fillStyle = "#ffffff";
    for (let x = -80; x < V + 80; x += 64) c.fillRect(x, 170, 30, V);
    c.globalAlpha = 1;
    c.fillStyle = "#c58a52";
    c.beginPath(); c.ellipse(200, 392, 168, 86, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#f3efe6"; c.lineWidth = 7;
    c.beginPath(); c.moveTo(40, 400); c.lineTo(150, 300); c.stroke();
    c.beginPath(); c.moveTo(360, 400); c.lineTo(250, 300); c.stroke();
    c.restore();
  } else if (bg === 7) {
    const g = c.createLinearGradient(0, 0, 0, V);
    g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    c.fillStyle = g; c.fillRect(0, 0, V, V);
    c.save(); c.globalAlpha = 0.28; c.fillStyle = "#ffffff";
    const beams: readonly (readonly [number, number])[] = [[60, 34], [200, 20], [340, 34]];
    beams.forEach((p) => {
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] - 110, V); c.lineTo(p[0] + 110, V); c.closePath(); c.fill();
    });
    c.globalAlpha = 0.9;
    beams.forEach((p) => {
      c.beginPath(); c.ellipse(p[0], p[1], 26, 16, 0, 0, Math.PI * 2); c.fill();
    });
    c.restore();
  }
}

function drawText(
  c: Ctx, txt: string, x: number, y: number, size: number,
  textColor: string, textLineColor: string, align: CanvasTextAlign = "center"
): void {
  if (!txt) return;
  c.save();
  c.font = `800 ${size}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`;
  c.textAlign = align; c.textBaseline = "middle";
  c.lineJoin = "round"; c.miterLimit = 2;
  c.lineWidth = Math.max(4, size * 0.24); c.strokeStyle = textLineColor;
  c.strokeText(txt, x, y);
  c.fillStyle = textColor; c.fillText(txt, x, y);
  c.restore();
}

/**
 * PlayerAppearance を Canvas に描画する。
 * @param ctx  描画先の 2D コンテキスト
 * @param appearance  generatePlayerAppearance() が返したオブジェクト
 * @param size  出力する正方形の一辺（px）。既定 400
 */
export function renderPlayerAppearance(ctx: Ctx, appearance: PlayerAppearance, size = 400): void {
  const P = toPalette(appearance);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.setTransform(size / V, 0, 0, size / V, 0, 0);

  drawBg(ctx, appearance.bg, appearance.bg1Color, appearance.bg2Color);

  const hair = HAIRS[appearance.hair];
  if (hair.back) hair.back(ctx, P);

  BODIES[appearance.body].d(ctx, P);
  ITEMS[appearance.item].d(ctx, P);

  // 首
  if (appearance.body !== 0) {
    ctx.beginPath(); rr(ctx, 176, 236, 48, 72, 14); fs(ctx, P.skin, P.line);
  }

  // 耳
  ctx.beginPath(); ctx.ellipse(88, 198, 18, 26, 0, 0, Math.PI * 2); fs(ctx, P.skin, P.line, 5);
  ctx.beginPath(); ctx.ellipse(312, 198, 18, 26, 0, 0, Math.PI * 2); fs(ctx, P.skin, P.line, 5);

  // 顔
  headPath(ctx, appearance.head); fs(ctx, P.skin, P.line);

  // 表情
  BEARDS[appearance.beard].d(ctx, P);

  const bx = EYE_DX + P.eyegap, by = BROW_Y + appearance.browYOffset, bk = 0.82;
  ctx.save(); ctx.translate(200 - bx, by); ctx.scale(bk, bk); BROWS[appearance.brow].d(ctx, P); ctx.restore();
  ctx.save(); ctx.translate(200 + bx, by); ctx.scale(-bk, bk); BROWS[appearance.brow].d(ctx, P); ctx.restore();

  eyePair(ctx, P, EYES[appearance.eye].d);
  NOSES[appearance.nose].d(ctx, P);
  ctx.save(); ctx.translate(200, MOUTH_Y); MOUTHS[appearance.mouth].d(ctx, P); ctx.restore();

  if (hair.front) hair.front(ctx, P);
  GLASSES[appearance.glasses].d(ctx, P);
  HATS[appearance.hat].d(ctx, P);
  EXTRAS[appearance.extra].d(ctx, P);

  drawText(ctx, appearance.hatText, 200, HATS[appearance.hat].textY, 44, appearance.textColor, appearance.textLineColor);
  drawText(ctx, appearance.numberText, 200, 366, 54, appearance.textColor, appearance.textLineColor);

  if (appearance.frameThickness > 0) {
    ctx.lineWidth = appearance.frameThickness * 2; ctx.strokeStyle = appearance.frameColor;
    ctx.beginPath(); ctx.rect(0, 0, V, V); ctx.stroke();
  }
}
