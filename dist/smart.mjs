// Local, deterministic assistance. These scores describe pixels, not the value of a memory.
const bound = (n, low, high) => Math.max(low, Math.min(high, Number(n) || 0));
export const EMPTY_EDITS = Object.freeze({brightness:0, contrast:0, saturation:0, warmth:0});

export function normalizeEdits(edits = {}) {
  edits=edits||{};
  return {brightness:bound(edits.brightness,-50,50), contrast:bound(edits.contrast,-40,40), saturation:bound(edits.saturation,-50,50), warmth:bound(edits.warmth,-40,40)};
}
export function hasEdits(edits) { return Object.values(normalizeEdits(edits)).some(v=>v!==0); }

export function applyPixelEdits(pixels, input) {
  const e=normalizeEdits(input);
  if (!hasEdits(e)) return pixels;
  const gain=2**(e.brightness/60), contrast=1+e.contrast/100, saturation=1+e.saturation/100, warmth=e.warmth/400;
  for(let i=0;i<pixels.length;i+=4){
    let r=(pixels[i]/255*gain-.5)*contrast+.5+warmth;
    let g=(pixels[i+1]/255*gain-.5)*contrast+.5;
    let b=(pixels[i+2]/255*gain-.5)*contrast+.5-warmth;
    const l=.2126*r+.7152*g+.0722*b;
    pixels[i]=(l+(r-l)*saturation)*255;
    pixels[i+1]=(l+(g-l)*saturation)*255;
    pixels[i+2]=(l+(b-l)*saturation)*255;
  }
  return pixels;
}

export function validCaptureDate(text) {
  if(typeof text!=='string')return null;
  const m=text.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if(!m)return null;
  const [y,mo,d,h,mi,s]=m.slice(1).map(Number);
  if(y<1900||y>2200||mo<1||mo>12||h>23||mi>59||s>59)return null;
  const date=new Date(Date.UTC(y,mo-1,d,h,mi,s));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d)return null;
  return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6];
}

export function fileCaptureDate(modified) {
  if(!Number.isFinite(modified)||modified<=0)return null;
  const d=new Date(modified), pad=n=>String(n).padStart(2,'0');
  if(!Number.isFinite(d.getTime()))return null;
  return validCaptureDate(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()));
}

export function readExifDate(buffer) {
  const v=new DataView(buffer), length=v.byteLength;
  const tiff=(start,end)=>{
    if(start+8>end)return null;
    const mark=v.getUint16(start), little=mark===0x4949;
    if(!little&&mark!==0x4d4d||v.getUint16(start+2,little)!==42)return null;
    const u32=at=>v.getUint32(at,little);
    const readIFD=offset=>{
      const at=start+offset;if(at<start+8||at+2>end)return [];
      const count=Math.min(v.getUint16(at,little),512),result=[];
      for(let i=0;i<count;i++){
        const entry=at+2+i*12;if(entry+12>end)break;
        result.push({tag:v.getUint16(entry,little),type:v.getUint16(entry+2,little),count:u32(entry+4),value:u32(entry+8),entry});
      }return result;
    };
    const ifd0=readIFD(u32(start+4)), pointer=ifd0.find(i=>i.tag===0x8769&&i.type===4&&i.count===1);
    const entries=pointer?readIFD(pointer.value):ifd0;
    for(const tag of [0x9003,0x9004]){
      const entry=entries.find(i=>i.tag===tag&&i.type===2&&i.count>=19&&i.count<=128);
      if(!entry)continue;
      const at=start+entry.value;
      if(at<start||at+entry.count>end)continue;
      const value=new TextDecoder('ascii').decode(new Uint8Array(buffer,at,entry.count));
      const date=validCaptureDate(value);if(date)return date;
    }return null;
  };
  try{
    if(length<8)return null;
    if([0x4949,0x4d4d].includes(v.getUint16(0)))return tiff(0,length);
    if(v.getUint16(0)===0xffd8){
      let at=2;
      while(at+4<=length){
        if(v.getUint8(at)!==0xff)break;
        while(at<length&&v.getUint8(at)===0xff)at++;
        if(at>=length)break;
        const marker=v.getUint8(at++);
        if(marker===0xda||marker===0xd9)break;
        if(marker>=0xd0&&marker<=0xd8||marker===1)continue;
        if(at+2>length)break;
        const size=v.getUint16(at), start=at+2, end=at+size;
        if(size<2||end>length)break;
        if(marker===0xe1&&start+6<=end&&v.getUint32(start)===0x45786966&&v.getUint16(start+4)===0){
          const date=tiff(start+6,end);if(date)return date;
        }at=end;
      }
    }else if(v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a){
      let at=8;
      while(at+12<=length){
        const size=v.getUint32(at),end=at+8+size;if(end+4>length)break;
        if(v.getUint32(at+4)===0x65584966)return tiff(at+8,end);
        at=end+4;
      }
    }
  }catch{}
  return null;
}

export function pixelQuality(rgba,width,height,originalWidth=width,originalHeight=height) {
  if(width<3||height<3||rgba.length!==width*height*4)throw new Error('Neveljavna analiza slike.');
  const gray=new Float32Array(width*height);let sum=0,sum2=0,dark=0,light=0;
  for(let i=0;i<gray.length;i++){
    const k=i*4,y=.2126*rgba[k]+.7152*rgba[k+1]+.0722*rgba[k+2];
    gray[i]=y;sum+=y;sum2+=y*y;if(y<20)dark++;if(y>235)light++;
  }
  const mean=sum/gray.length,contrast=Math.sqrt(Math.max(0,sum2/gray.length-mean*mean));
  let lap=0,lap2=0,n=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,l=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width];lap+=l;lap2+=l*l;n++;
  }
  const detail=Math.max(0,lap2/n-(lap/n)**2),darkRatio=dark/gray.length,lightRatio=light/gray.length;
  // Area-averaged 9x8 difference hash; only a hint for visually similar bursts.
  const small=[];
  for(let gy=0;gy<8;gy++)for(let gx=0;gx<9;gx++){
    let total=0,count=0;
    const x0=Math.floor(gx*width/9),x1=Math.max(x0+1,Math.floor((gx+1)*width/9));
    const y0=Math.floor(gy*height/8),y1=Math.max(y0+1,Math.floor((gy+1)*height/8));
    for(let y=y0;y<Math.min(height,y1);y++)for(let x=x0;x<Math.min(width,x1);x++){total+=gray[y*width+x];count++;}
    small.push(total/count);
  }
  let hash=0n;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)hash=(hash<<1n)|(small[y*9+x]>small[y*9+x+1]?1n:0n);
  const exposure=bound(1-Math.abs(mean-128)/155-darkRatio*.45-lightRatio*.6,0,1);
  const resolution=bound(Math.sqrt(originalWidth*originalHeight/12000000),0,1);
  const score=Math.round(100*(.35*exposure+.35*bound(Math.log1p(detail)/8,0,1)+.15*bound(contrast/52,0,1)+.15*resolution));
  return {mean,contrast,detail,dark:darkRatio,light:lightRatio,score,hash:hash.toString(16).padStart(16,'0')};
}

export function qualityFlags(record) {
  if(!record)return [];
  if(!record.quality)return ['Brez analize'];
  const q=record.quality,flags=[];
  if(q.mean<65||q.dark>.5)flags.push('Temna');
  if(q.mean>205||q.light>.35)flags.push('Presvetla');
  if(q.detail<35)flags.push('Malo podrobnosti');
  if(record.width*record.height<2000000)flags.push('Nizka ločljivost');
  return flags;
}

export function sanitizeAnalysis(record) {
  if(!record||typeof record!=='object')return null;
  const date=validCaptureDate(record.capturedAt), source=date&&record.source==='exif'?'exif':date?'file':'none';
  const result={capturedAt:date,source,width:bound(record.width,0,200000),height:bound(record.height,0,200000),quality:null};
  const q=record.quality;
  if(q&&['mean','contrast','detail','dark','light','score'].every(k=>Number.isFinite(q[k]))&&/^[a-f0-9]{16}$/.test(q.hash)){
    result.quality={mean:bound(q.mean,0,255),contrast:bound(q.contrast,0,255),detail:bound(q.detail,0,2000000),dark:bound(q.dark,0,1),light:bound(q.light,0,1),score:bound(q.score,0,100),hash:q.hash};
  }return result;
}

export function captureFor(item,analysis={}) {
  const record=analysis[item.id];
  return record?.capturedAt||fileCaptureDate(item.modified);
}

export function dateSegments(items,analysis={},mode='day') {
  if(mode==='none')return [{key:'all',label:'Vse fotografije',items:[...items]}];
  const sorted=[...items].sort((a,b)=>(captureFor(a,analysis)||'9999').localeCompare(captureFor(b,analysis)||'9999')||a.path.localeCompare(b.path,undefined,{numeric:true}));
  const groups=[];let lastDay='',lastTime=0,part=0;
  for(const item of sorted){
    const date=captureFor(item,analysis),day=date?.slice(0,10)||'unknown';
    const time=date?Date.parse(date+'Z'):0;
    if(day!==lastDay){part=0;lastTime=0;}
    if(mode==='segment'&&day===lastDay&&lastTime&&time-lastTime>90*60000)part++;
    const key=day+(mode==='segment'?':'+part:'');
    let group=groups.at(-1);
    if(!group||group.key!==key){group={key,day,start:date,end:date,items:[]};groups.push(group);}
    group.items.push(item);group.end=date;lastDay=day;lastTime=time;
  }
  return groups.map(g=>({...g,label:g.day==='unknown'?'Datum ni znan':g.day.split('-').reverse().join('. ')+(mode==='segment'&&g.start?' · '+g.start.slice(11,16)+(g.end!==g.start?'–'+g.end.slice(11,16):''):'' )}));
}

export function hashDistance(a,b) {
  if(!/^[a-f0-9]{16}$/.test(a||'')||!/^[a-f0-9]{16}$/.test(b||''))return 64;
  let bits=BigInt('0x'+a)^BigInt('0x'+b),count=0;while(bits){bits&=bits-1n;count++;}return count;
}

function similarBurst(a,b,analysis) {
  const ra=analysis[a.id],rb=analysis[b.id];
  if(!ra?.quality||!rb?.quality)return false;
  const ta=captureFor(a,analysis),tb=captureFor(b,analysis);
  if(!ta||!tb||ta.slice(0,10)!==tb.slice(0,10)||Math.abs(Date.parse(ta+'Z')-Date.parse(tb+'Z'))>180000)return false;
  return hashDistance(ra.quality.hash,rb.quality.hash)<=5;
}

export function proposeSelection(session) {
  const analysis=session.analysis||{}, manual=new Set(session.selected), total=Math.max(session.target,manual.size);
  const ranked=session.items.filter(i=>analysis[i.id]?.quality&&!manual.has(i.id)).sort((a,b)=>analysis[b.id].quality.score-analysis[a.id].quality.score||a.path.localeCompare(b.path,undefined,{numeric:true}));
  const representatives=session.items.filter(i=>manual.has(i.id)),unique=[],similar=[];
  for(const item of ranked){
    if(representatives.some(other=>similarBurst(item,other,analysis)))similar.push(item);
    else{unique.push(item);representatives.push(item);}
  }
  const groups=dateSegments(session.items,analysis,'segment');
  const groupFor=new Map();groups.forEach(g=>g.items.forEach(i=>groupFor.set(i.id,g.key)));
  const counts=new Map(groups.map(g=>[g.key,g.items.filter(i=>manual.has(i.id)).length]));
  const weight=new Map(groups.map(g=>[g.key,Math.sqrt(g.items.length)]));
  const added=[];
  for(const pool of [unique,similar]){
    const remaining=[...pool];
    while(manual.size+added.length<total&&remaining.length){
      let best=0,bestValue=-Infinity;
      for(let k=0;k<remaining.length;k++){
        const item=remaining[k],key=groupFor.get(item.id);
        // Cover moments first, then favor higher technical scores within each segment.
        const value=analysis[item.id].quality.score/100-5*(counts.get(key)||0)/(weight.get(key)||1);
        if(value>bestValue){best=k;bestValue=value;}
      }
      const item=remaining.splice(best,1)[0],key=groupFor.get(item.id);added.push(item.id);counts.set(key,(counts.get(key)||0)+1);
    }
  }
  return {ids:added,similarIds:similar.map(i=>i.id),existing:manual.size,analyzed:session.items.filter(i=>analysis[i.id]?.quality).length,groups:groups.length,filledWithSimilar:added.filter(id=>similar.some(i=>i.id===id)).length};
}

export function autoEdits(record) {
  if(!record?.quality)return {...EMPTY_EDITS};
  const q=record.quality;
  // Restrained global adjustment. Intentionally no attempt to invent missing detail.
  return normalizeEdits({brightness:Math.round(bound((125-q.mean)*.25,-18,25)),contrast:Math.round(bound((45-q.contrast)*.22,-5,10)),saturation:0,warmth:0});
}
