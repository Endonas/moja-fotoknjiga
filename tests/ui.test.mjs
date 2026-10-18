// Event-flow smoke test with a minimal DOM/canvas adapter. This is not browser or codec QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const root=new URL('../dist/',import.meta.url);

class Node {
  constructor(tag='div',fragment=false){this.tagName=tag;this.fragment=fragment;this.children=[];this.events={};this.attributes={};this.dataset={};this.hidden=false;this.value='';this._text='';this.className='';this.open=false;this.width=10;this.height=10;this.naturalWidth=100;this.naturalHeight=100;
    this.classList={add:(s)=>this.classes(new Set([...this.className.split(' '),s])),remove:s=>this.classes(new Set(this.className.split(' ').filter(c=>c!==s))),toggle:(s,on)=>{const c=new Set(this.className.split(' '));const next=on??!c.has(s);next?c.add(s):c.delete(s);this.classes(c);return next;}};
  }
  classes(c){this.className=[...c].filter(Boolean).join(' ');}
  get childNodes(){return this.children;}
  get lastChild(){return this.children.at(-1);}
  get isConnected(){return true;}
  set textContent(s){this._text=String(s);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
  append(...nodes){for(const n of nodes){if(n.fragment){this.append(...n.children);continue;}n.parent=this;this.children.push(n);}}
  prepend(n){n.parent=this;this.children.unshift(n);}
  replaceChildren(...n){this.children=[];this._text='';this.append(...n);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k];}
  removeAttribute(k){delete this.attributes[k];}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  async fire(type,extras={}){for(const fn of this.events[type]||[])await fn({target:this,preventDefault(){},...extras});}
  click(){return this.fire('click');}
  matches(q){return q[0]==='.'?this.className.split(' ').includes(q.slice(1)):this.tagName===q;}
  querySelectorAll(q){return this.children.flatMap(c=>[...(c.matches(q)?[c]:[]),...c.querySelectorAll(q)]);}
  querySelector(q){return this.querySelectorAll(q)[0]||null;}
  closest(){return null;}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;this.fire('close');}}
  set src(v){this._src=v;queueMicrotask(()=>this.onload?.());}
  get src(){return this._src;}
  getContext(){const canvas=this;return {fillRect(){},drawImage(){},putImageData(){},getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set([i%8?80:175,120,120,255],i);return {data,width:w,height:h};}};}
  toBlob(callback,type){callback(new Blob(['mock-encoded-image'],{type}));}
}

function runtime(){
  const html=fs.readFileSync(new URL('index.html',root),'utf8');
  const nodes=new Map([...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(m=>[m[2],new Node(m[1])]));
  nodes.get('groupMode').value='day';nodes.get('workspace').hidden=true;
  nodes.get('previewFavorite').append(new Node('span'));
  const documents={getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),createElementNS:(ns,tag)=>{const n=new Node(tag);n.namespaceURI=ns;return n;},createDocumentFragment:()=>new Node('fragment',true),addEventListener(){},body:new Node('body')};
  let local='';const localStorage={getItem:()=>local||null,setItem:(k,v)=>{local=v;}};
  const window={IntersectionObserver:true,addEventListener(){}};
  const script=['smart.mjs','core.mjs','imaging.mjs','app.mjs'].map(file=>fs.readFileSync(new URL(file,root),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export\s+/gm,'')).join('\n');
  const context={document:documents,window,localStorage,crypto:webcrypto,console,Intl,Date,Map,Set,Blob,File,DataView,Uint8Array,Uint8ClampedArray,Float32Array,TextEncoder,TextDecoder,URL,setTimeout,clearTimeout,queueMicrotask,ImageData:class{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}},requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,IntersectionObserver:class{observe(){}unobserve(){}disconnect(){}},createImageBitmap:async()=>({width:3200,height:2400,close(){}})};
  vm.runInNewContext('(() => {\n'+script+'\n})();',context);
  return {nodes,db:()=>JSON.parse(local),localStorage};
}

test('real app events: load 377, analyze without selecting, review suggestion, accept 60, undo in one action',async()=>{
  const {nodes,db}=runtime(),files=Array.from({length:377},(_,i)=>{
    const f=new File(['not-real-image'],'IMG_'+i+'.jpg',{type:'image/jpeg',lastModified:1770000000000+i*600000});
    Object.defineProperty(f,'webkitRelativePath',{value:'Dopust/'+f.name});return f;
  });
  nodes.get('folderInput').files=files;await nodes.get('folderInput').fire('change');
  // Input handler starts asynchronous hashing; wait for the visible workspace to open.
  for(let n=0;n<100&&nodes.get('workspace').hidden;n++)await new Promise(r=>setTimeout(r,2));
  assert.equal(nodes.get('allCount').textContent,'377');assert.equal(nodes.get('selectedCount').textContent,'0');
  await nodes.get('analyzeButton').fire('click');
  assert.equal(nodes.get('selectedCount').textContent,'0','analysis is not selection');
  assert.equal(nodes.get('proposalCount').textContent,'60');
  assert.equal(nodes.get('proposalBanner').hidden,false);
  await nodes.get('reviewProposal').fire('click');
  assert.equal(nodes.get('photoGrid').querySelectorAll('.photo-card').length,60);
  await nodes.get('applyProposal').fire('click');
  assert.equal(nodes.get('selectedCount').textContent,'60');
  const s=db().sessions[db().latest];assert.equal(s.selected.length,60);assert.equal(Object.keys(s.analysis).length,377);
  await nodes.get('undoButton').fire('click');
  assert.equal(nodes.get('selectedCount').textContent,'0');
  await nodes.get('allFilter').fire('click');
  await nodes.get('photoGrid').querySelectorAll('.photo-open')[0].fire('click');
  await new Promise(r=>setTimeout(r,2));
  assert.equal(nodes.get('previewDialog').open,true);
  assert.equal(nodes.get('brightnessSlider').disabled,false);
  nodes.get('brightnessSlider').value='20';await nodes.get('brightnessSlider').fire('input');await nodes.get('brightnessSlider').fire('change');
  await new Promise(r=>setTimeout(r,2));
  assert.equal(nodes.get('editCanvas').hidden,false);
  assert.equal(nodes.get('previewImage').hidden,true);
  const edited=db().sessions[db().latest];assert.ok(Object.values(edited.edits).some(e=>e.brightness===20));
  assert.equal(edited.selected.length,0,'editing does not alter favorites');
  await nodes.get('compareOriginal').fire('click');
  assert.equal(nodes.get('previewImage').hidden,false);assert.equal(nodes.get('editCanvas').hidden,true);
  await nodes.get('closePreview').fire('click');assert.equal(nodes.get('previewDialog').open,false);
});
