import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {metadata, collectionId, newSession, toggleFavorite, undoSelection, changeSelection, selectedItems, readDatabase, writeDatabase, backupText, parseBackup, powershellScript, safePath, copyPhotos, STORE_KEY} from '../dist/core.mjs';

function photo(name, folder = 'Dopust', modified = 1770000000000, body = 'local-photo-content') {
  const f = new File([body], name, {type:'image/jpeg', lastModified:modified});
  Object.defineProperty(f,'webkitRelativePath',{value:folder ? folder + '/' + name : ''});
  return f;
}
const fixture = Array.from({length:377},(_,i) => photo('IMG_' + String(i+1).padStart(4,'0') + '.jpg'));
const items = fixture.map(metadata);
const id = await collectionId(items);
const initial = () => newSession(id,items,'Dopust');
const storage = () => { const data=new Map(); return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),data}; };
const sixty = () => items.slice(0,60).reduce((s,i)=>toggleFavorite(s,i.id),initial());

test('377 photos: 60 favorites survive storage, a new session and another import order', async () => {
  const local=storage(), session=sixty();
  writeDatabase(local,{version:1,latest:id,sessions:{[id]:session}});
  const restored=readDatabase(local).sessions[id];
  assert.equal(restored.items.length,377);
  assert.equal(restored.selected.length,60);
  assert.deepEqual(selectedItems(restored).map(x=>x.name),items.slice(0,60).map(x=>x.name));
  assert.equal(await collectionId([...items].reverse()),id);
  assert.ok(local.data.get(STORE_KEY).length < 150000,'compact metadata and undo history');
  assert.ok(!local.data.get(STORE_KEY).includes('local-photo-content'),'no image bytes in localStorage');
});

test('a missed favorite changes exactly one photo; undo restores all 60, even after reload', () => {
  const chosen=sixty(), missed=toggleFavorite(chosen,items[22].id);
  assert.equal(missed.selected.length,59);
  assert.ok(items.slice(0,60).filter((_,i)=>i!==22).every(x=>missed.selected.includes(x.id)));
  const local=storage();writeDatabase(local,{version:1,latest:id,sessions:{[id]:missed}});
  const undone=undoSelection(readDatabase(local).sessions[id]);
  assert.equal(undone.selected.length,60);
  assert.deepEqual(new Set(undone.selected),new Set(chosen.selected));
});

test('a new favorite beyond the goal is allowed and undo touches only the last change', () => {
  const session=toggleFavorite(sixty(),items[60].id);
  assert.equal(session.selected.length,61);
  assert.equal(undoSelection(session).selected.length,60);
  assert.equal(toggleFavorite(session,'unknown-id'),session);
});

test('100 undo operations remain available and remain compact', () => {
  let session=initial();
  for (const item of items) session=toggleFavorite(session,item.id);
  assert.equal(session.history.length,100);
  for (let n=0;n<100;n++) session=undoSelection(session);
  assert.equal(session.selected.length,277);
  assert.equal(undoSelection(session),session);
});

test('backup restores filenames, targets and selections without image data', async () => {
  const chosen={...sixty(),target:75};
  const exported=backupText(chosen), restored=await parseBackup(exported);
  assert.equal(restored.selected.length,60);
  assert.equal(restored.target,75);
  assert.equal(restored.items.length,377);
  assert.ok(!exported.includes('local-photo-content'));
  const changed=changeSelection(chosen,items.slice(10,20).map(x=>x.id));
  assert.equal(changed.selected.length,10);
  assert.equal(undoSelection(changed).selected.length,60,'restoring a backup can be undone');
});

test('invalid backups and path traversal are rejected before a file operation', async () => {
  for (const path of ['../a.jpg','/a.jpg','a/../b.jpg','a\\b.jpg','C:/a.jpg','a//b.jpg','a/./b.jpg']) assert.throws(()=>safePath(path));
  assert.equal(safePath('Šenčur/IMG [1] & test.jpg'),'Šenčur/IMG [1] & test.jpg');
  const broken=JSON.parse(backupText(sixty()));broken.session.items[0].path='another.jpg';
  await assert.rejects(parseBackup(JSON.stringify(broken)));
  const tampered=JSON.parse(backupText(sixty()));tampered.session.id='a'.repeat(64);
  await assert.rejects(parseBackup(JSON.stringify(tampered)),/poškodovana/);
  await assert.rejects(parseBackup('{"version":2}'));
});

test('different folders have different identities; same basenames in subfolders stay distinct', async () => {
  const a=metadata(photo('same.jpg','Dopust/Prvi dan'));
  const b=metadata(photo('same.jpg','Dopust/Drugi dan'));
  assert.notEqual(a.id,b.id);
  assert.equal(a.relative,'Prvi dan/same.jpg');
  assert.notEqual(await collectionId([a]),await collectionId([b]));
  assert.equal(metadata(photo('one.jpg','')).relative,'one.jpg');
});

test('the Windows copy script preserves Unicode, brackets, quotes and nested relative paths', () => {
  const special=[metadata(photo("Š Č Ž [1] ' & $.jpg",'Počitnice/Dan 1')),metadata(photo('same.jpg','Počitnice/Dan 2'))];
  const script=powershellScript(special,'Počitnice');
  const encoded=script.match(/FromBase64String\('([^']+)'\)/)[1];
  assert.deepEqual(JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),special.map(i=>i.relative));
  assert.match(script,/Copy-Item -LiteralPath/);
  assert.match(script,/while \(Test-Path -LiteralPath \$destination\)/);
  assert.ok(!/Remove-Item|Move-Item/.test(script));
});

class Directory {
  constructor(name){this.name=name;this.directories=new Map();this.files=new Map();}
  async getDirectoryHandle(name,options={}){
    if(!this.directories.has(name)){
      if(!options.create)throw new DOMException('Missing folder','NotFoundError');
      this.directories.set(name,new Directory(name));
    }
    return this.directories.get(name);
  }
  async getFileHandle(name){
    return {createWritable:async()=>{
      const chunks=[];
      return new WritableStream({write:chunk=>chunks.push(chunk),close:()=>{this.files.set(name,new Blob(chunks));}});
    }};
  }
}

test('copying uses original bytes, preserves subfolders and never overwrites a previous export', async () => {
  const a=photo('same.jpg','Dopust/Eno',1770000000000,'ORIGINAL A');
  const b=photo('same.jpg','Dopust/Dva',1770000000000,'ORIGINAL B');
  const selected=[metadata(a),metadata(b)], fileMap=new Map([[selected[0].id,a],[selected[1].id,b]]);
  const output=new Directory('Output'), progress=[];
  const stamp=new Date('2026-10-18T12:00:00Z');
  const first=await copyPhotos(selected,fileMap,output,(n,total)=>progress.push([n,total]),stamp);
  assert.equal(first.copied,2); assert.deepEqual(progress,[[1,2],[2,2]]);
  const root=output.directories.get(first.name);
  assert.equal(await root.directories.get('Eno').files.get('same.jpg').text(),'ORIGINAL A');
  assert.equal(await root.directories.get('Dva').files.get('same.jpg').text(),'ORIGINAL B');
  const second=await copyPhotos(selected,fileMap,output,()=>{},stamp);
  assert.notEqual(first.name,second.name);
  assert.equal(output.directories.size,2);
  assert.equal(await a.text(),'ORIGINAL A');assert.equal(await b.text(),'ORIGINAL B');
});

test('missing originals fail before any output directory is created', async () => {
  const output=new Directory('Output');
  await assert.rejects(copyPhotos(items.slice(0,60),new Map(),output),/poveži/);
  assert.equal(output.directories.size,0);
});

test('local-storage errors propagate and corrupted databases are not silently accepted', () => {
  const full={setItem(){throw new DOMException('Full','QuotaExceededError')}};
  assert.throws(()=>writeDatabase(full,{version:1,sessions:{}}),/Full/);
  assert.throws(()=>readDatabase({getItem(){return '{broken';}}));
});

test('client assets have no remote resources or photo upload code and every DOM binding exists', () => {
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(ids.length,new Set(ids).size,'unique DOM ids');
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),'missing element '+match[1]);
  for(const attr of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    if(attr[1].startsWith('#'))continue;
    assert.ok(!/^https?:\/\//.test(attr[1]),'no remote resources');
  }
  assert.match(html,/connect-src 'none'/);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(app));
  assert.ok(!/\.innerHTML\s*=/.test(app),'file names are inserted using textContent');
});
