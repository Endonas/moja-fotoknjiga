import test from 'node:test';
import assert from 'node:assert/strict';
import {readExifDate,validCaptureDate,dateSegments,pixelQuality,qualityFlags,proposeSelection,normalizeEdits,hasEdits,applyPixelEdits,autoEdits,sanitizeAnalysis} from '../dist/smart.mjs';
import {metadata,collectionId,newSession,changeSelection,undoSelection,backupText,parseBackup,readDatabase,writeDatabase,copyPhotos} from '../dist/core.mjs';

function exifTiff(date,little=true){
  const b=new ArrayBuffer(70),v=new DataView(b),bytes=new Uint8Array(b);
  v.setUint16(0,little?0x4949:0x4d4d);v.setUint16(2,42,little);v.setUint32(4,8,little);
  v.setUint16(8,1,little);v.setUint16(10,0x8769,little);v.setUint16(12,4,little);v.setUint32(14,1,little);v.setUint32(18,26,little);
  v.setUint16(26,1,little);v.setUint16(28,0x9003,little);v.setUint16(30,2,little);v.setUint32(32,20,little);v.setUint32(36,44,little);
  bytes.set(new TextEncoder().encode(date+'\0'),44);return b;
}
function jpegExif(date,little=true){
  const tiff=new Uint8Array(exifTiff(date,little)), b=new Uint8Array(tiff.length+14),v=new DataView(b.buffer);
  b.set([0xff,0xd8,0xff,0xe1]);v.setUint16(4,tiff.length+8);b.set([69,120,105,102,0,0],6);b.set(tiff,12);b.set([0xff,0xd9],b.length-2);return b.buffer;
}
const pixels=(w,h,fn)=>{
  const a=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=fn(x,y);a.set([v,v,v,255],i);}return a;
};
const photo=(n)=>metadata({name:'IMG_'+n+'.jpg',webkitRelativePath:'Dopust/IMG_'+n+'.jpg',size:123456,lastModified:1770000000000+n});
const quality=(score,hash='0123456789abcdef')=>({score,hash,mean:128,contrast:50,detail:200,dark:0,light:0});
const record=(date,score,hash)=>({capturedAt:date,source:'exif',width:4000,height:3000,quality:quality(score,hash)});

test('EXIF original capture date is read from JPEG and TIFF in both byte orders',()=>{
  for(const little of [true,false]){
    assert.equal(readExifDate(exifTiff('2024:07:19 23:59:05',little)),'2024-07-19T23:59:05');
    assert.equal(readExifDate(jpegExif('2024:07:19 23:59:05',little)),'2024-07-19T23:59:05');
  }
});

test('PNG EXIF dates and malformed EXIF data are handled without crashes',()=>{
  const tiff=new Uint8Array(exifTiff('2024:02:29 10:30:00')),b=new Uint8Array(tiff.length+20),v=new DataView(b.buffer);
  b.set([137,80,78,71,13,10,26,10]);v.setUint32(8,tiff.length);v.setUint32(12,0x65584966);b.set(tiff,16);
  assert.equal(readExifDate(b.buffer),'2024-02-29T10:30:00');
  const original=jpegExif('2024:07:19 23:59:05');
  for(let n=0;n<original.byteLength;n++)assert.doesNotThrow(()=>readExifDate(original.slice(0,n)));
  assert.equal(validCaptureDate('2025:02:29 10:00:00'),null);
  assert.equal(validCaptureDate('2024:01:01 25:00:00'),null);
});

test('dates form days and split moments after 90 minutes without UTC date shifts',()=>{
  const a=photo(1),b=photo(2),c=photo(3),d=photo(4);
  const analysis={
    [a.id]:record('2024-07-19T00:01:00',70),[b.id]:record('2024-07-19T01:31:00',75),
    [c.id]:record('2024-07-19T03:02:00',80),[d.id]:record('2024-07-20T00:01:00',60)
  };
  assert.equal(dateSegments([d,c,b,a],analysis,'day').length,2);
  const segments=dateSegments([d,c,b,a],analysis,'segment');
  assert.equal(segments.length,3);assert.deepEqual(segments[0].items,[a,b]);assert.equal(segments[0].day,'2024-07-19');
  assert.deepEqual(dateSegments([d,c,b,a],analysis,'none')[0].items,[d,c,b,a]);
});

test('technical warnings distinguish dark, clipped, low-resolution and low-detail pixels',()=>{
  const width=32,height=32;
  const dark=pixelQuality(pixels(width,height,()=>0),width,height,4000,3000);
  const white=pixelQuality(pixels(width,height,()=>255),width,height,4000,3000);
  const textured=pixelQuality(pixels(width,height,(x,y)=>(x+y)%2?80:175),width,height,4000,3000);
  assert.ok(qualityFlags({width:4000,height:3000,quality:dark}).includes('Temna'));
  assert.ok(qualityFlags({width:4000,height:3000,quality:white}).includes('Presvetla'));
  assert.ok(qualityFlags({width:400,height:300,quality:textured}).includes('Nizka ločljivost'));
  assert.ok(textured.score>dark.score&&textured.score>white.score);
  assert.match(textured.hash,/^[a-f0-9]{16}$/);
});

test('377-photo suggestion reaches 60 while covering all days and preserving manual favorites',async()=>{
  const items=Array.from({length:377},(_,i)=>photo(i));
  const id=await collectionId(items),s=newSession(id,items,'Dopust');
  items.forEach((item,i)=>{
    const day=String(1+Math.floor(i/126)).padStart(2,'0'),hour=String(Math.floor(i%126/4)%24).padStart(2,'0'),minute=String(i%4*12).padStart(2,'0');
    s.analysis[item.id]=record('2024-07-'+day+'T'+hour+':'+minute+':00',40+i%60,BigInt(i+1).toString(16).padStart(16,'0'));
  });
  s.selected=[items[0].id,items[160].id];const original=[...s.selected],p=proposeSelection(s);
  assert.equal(p.ids.length,58);assert.deepEqual(s.selected,original,'proposal is not applied automatically');
  const chosen=changeSelection(s,[...s.selected,...p.ids]);
  assert.equal(chosen.selected.length,60);assert.ok(original.every(id=>chosen.selected.includes(id)));
  assert.equal(new Set(chosen.selected.map(id=>s.analysis[id].capturedAt.slice(0,10))).size,3);
  assert.deepEqual(new Set(undoSelection(chosen).selected),new Set(original),'one undo reverts the whole addition');
});

test('a better burst photo is proposed before near duplicates; unsupported photos are not silently rated',async()=>{
  const items=[photo(1),photo(2),photo(3),photo(4)],s=newSession(await collectionId(items),items,'Dopust');s.target=2;
  s.analysis[items[0].id]=record('2024-07-01T10:00:00',60,'0000000000000000');
  s.analysis[items[1].id]=record('2024-07-01T10:00:01',90,'0000000000000001');
  s.analysis[items[2].id]=record('2024-07-02T12:00:00',70,'ffffffffffffffff');
  s.analysis[items[3].id]={capturedAt:null,source:'none',width:0,height:0,quality:null};
  const p=proposeSelection(s);
  assert.deepEqual(new Set(p.ids),new Set([items[1].id,items[2].id]));assert.equal(p.analyzed,3);assert.equal(p.filledWithSimilar,0);
  s.target=4;assert.equal(proposeSelection(s).ids.length,3,'never makes up an assessment for an unreadable file');
});

test('edits are bounded, neutral edits preserve bytes, and brightness and warmth have the intended effect',()=>{
  const original=new Uint8ClampedArray([100,100,100,255]),neutral=original.slice();
  assert.deepEqual(applyPixelEdits(neutral,{}),original);assert.ok(!hasEdits(null));
  const bright=applyPixelEdits(original.slice(),{brightness:30});assert.ok(bright[0]>original[0]);assert.equal(bright[3],255);
  const warm=applyPixelEdits(original.slice(),{warmth:20});assert.ok(warm[0]>original[0]&&warm[2]<original[2]);
  assert.equal(normalizeEdits({brightness:500}).brightness,50);assert.equal(normalizeEdits({contrast:-500}).contrast,-40);
  assert.deepEqual(original,new Uint8ClampedArray([100,100,100,255]));
  assert.ok(autoEdits({quality:quality(40),width:4000,height:3000}).brightness<0);
  const dark=record('2024-07-01T10:00:00',40);dark.quality.mean=40;assert.ok(autoEdits(dark).brightness>0);
});

test('old backups remain readable and upgraded backups retain scores and edits without changing selection IDs',async()=>{
  const items=[photo(1),photo(2)],s=newSession(await collectionId(items),items,'Dopust');s.selected=[items[0].id];
  delete s.analysis;delete s.edits;
  const legacy=await parseBackup(backupText(s));assert.equal(legacy.selected[0],items[0].id);assert.deepEqual(legacy.edits,{});
  legacy.analysis[items[0].id]=record('2024-07-01T10:00:00',80);legacy.edits[items[0].id]={brightness:15,contrast:5,saturation:0,warmth:0};
  const updated=await parseBackup(backupText(legacy));assert.equal(updated.analysis[items[0].id].quality.score,80);assert.equal(updated.edits[items[0].id].brightness,15);
  const store={data:'',getItem(){return this.data;},setItem(k,v){this.data=v;}};
  writeDatabase(store,{version:1,latest:s.id,sessions:{[s.id]:updated}});
  assert.deepEqual(readDatabase(store).sessions[s.id].selected,s.selected);
  assert.equal(sanitizeAnalysis({capturedAt:'nope',quality:{score:Infinity}}).quality,null);
});

class TestDir{
  constructor(){this.dirs=new Map();this.files=new Map();}
  async getDirectoryHandle(name,o={}){if(!this.dirs.has(name)){if(!o.create)throw new DOMException('Missing','NotFoundError');this.dirs.set(name,new TestDir());}return this.dirs.get(name);}
  async getFileHandle(name){return {createWritable:async()=>{const chunks=[];return new WritableStream({write:c=>chunks.push(c),close:()=>this.files.set(name,new Blob(chunks))});}};}
}

test('corrected exports do not overwrite originals, unchanged files or colliding output names',async()=>{
  const original=new File(['ORIGINAL'],'a.jpg',{lastModified:1}),collision=new File(['KEEP'],'a.jpg.popravljeno.jpg',{lastModified:2});
  const a=metadata(original),b=metadata(collision),files=new Map([[a.id,original],[b.id,collision]]),dir=new TestDir();
  const result=await copyPhotos([a,b],files,dir,()=>{},new Date('2026-10-18'),async item=>item.id===a.id?{blob:new Blob(['CORRECTED']),relative:a.relative+'.popravljeno.jpg'}:null);
  const output=dir.dirs.get(result.name);assert.equal(output.files.size,2);
  assert.deepEqual(new Set(await Promise.all([...output.files.values()].map(v=>v.text()))),new Set(['CORRECTED','KEEP']));
  assert.equal(await original.text(),'ORIGINAL');assert.equal(await collision.text(),'KEEP');
});
