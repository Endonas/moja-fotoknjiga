import {readExifDate, fileCaptureDate, pixelQuality, normalizeEdits, hasEdits, applyPixelEdits} from './smart.mjs?v=1.2.1';

export async function decodeLocalPhoto(file) {
  try{
    const source=await createImageBitmap(file,{imageOrientation:'from-image'});
    return {source,width:source.width,height:source.height,close:()=>source.close()};
  }catch{
    const url=URL.createObjectURL(file),image=new Image();image.src=url;
    try{await image.decode();return {source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)};}
    catch(e){URL.revokeObjectURL(url);throw e;}
  }
}

export function photoCanvas(decoded,maxSide=Infinity) {
  const scale=Math.min(1,maxSide/Math.max(decoded.width,decoded.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(decoded.width*scale));canvas.height=Math.max(1,Math.round(decoded.height*scale));
  const context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  if(!context)throw new Error('Brskalnik ne more obdelati slike.');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(decoded.source,0,0,canvas.width,canvas.height);
  return canvas;
}

export function editCanvasPixels(canvas,edits) {
  if(!hasEdits(edits))return canvas;
  const ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height);
  applyPixelEdits(data.data,edits);ctx.putImageData(data,0,0);return canvas;
}

export async function inspectLocalPhoto(file) {
  let capturedAt=null;
  try{capturedAt=readExifDate(await file.slice(0,524288).arrayBuffer());}catch{}
  const record={capturedAt:capturedAt||fileCaptureDate(file.lastModified),source:capturedAt?'exif':file.lastModified?'file':'none',width:0,height:0,quality:null};
  let decoded;
  try{
    decoded=await decodeLocalPhoto(file);
    record.width=decoded.width;record.height=decoded.height;
    const canvas=photoCanvas(decoded,256);
    if(canvas.width<3||canvas.height<3)return record;
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    record.quality=pixelQuality(data.data,canvas.width,canvas.height,record.width,record.height);
    canvas.width=canvas.height=1;
  }catch{}
  finally{decoded?.close();}
  return record;
}

export function canvasBlob(canvas,type='image/jpeg',quality=.95) {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Slike ni bilo mogoče izvoziti.')),type,quality));
}

export async function correctedPhoto(file,edits) {
  let decoded,canvas;
  try{
    decoded=await decodeLocalPhoto(file);
    canvas=photoCanvas(decoded);editCanvasPixels(canvas,normalizeEdits(edits));
    return await canvasBlob(canvas);
  }finally{decoded?.close();if(canvas)canvas.width=canvas.height=1;}
}
