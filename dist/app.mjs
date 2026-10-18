import {IMAGE_PATTERN, metadata, collectionId, newSession, toggleFavorite, undoSelection, selectedItems, readDatabase, writeDatabase, backupText, parseBackup, changeSelection, powershellScript, copyPhotos} from './core.mjs?v=1.2.1';
import {normalizeEdits, hasEdits, applyPixelEdits, qualityFlags, captureFor, dateSegments, proposeSelection, autoEdits} from './smart.mjs?v=1.2.1';
import {decodeLocalPhoto, photoCanvas, editCanvasPixels, inspectLocalPhoto, canvasBlob, correctedPhoto} from './imaging.mjs?v=1.2.1';

const $ = id => document.getElementById(id);
const icons = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS(s.namespaceURI, 'use'); u.setAttribute('href', '#i-' + name); s.append(u); s.setAttribute('aria-hidden', 'true'); return s; };
let db = {version: 1, latest: null, sessions: {}}, current = null;
let files = new Map(), thumbs = new Map(), cards = new Map(), filter = 'all', query = '', defaultTarget = 60;
let thumbnailGeneration = 0, queue = [], activeJobs = 0, thumbObserver;
let previewIds = [], previewIndex = 0, previewURL = null, toastTimeout, loading = false, copying = false, storageOkay = true;
let proposal = null, analyzing = false, cancelAnalysis = false, analysisEpoch = 0;
let previewPixels = null, comparingOriginal = false, editFrame = 0, editingBusy = false;
const dirtyEdits = new Set();
const collator = new Intl.Collator('sl', {numeric: true, sensitivity: 'base'});

function toast(message, duration = 4200) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, duration);
}

function storageWarning(message) {
  storageOkay = false;
  $('storageWarning').textContent = message;
  $('storageWarning').hidden = false;
  $('saveDot').classList.add('unsaved');
  $('saveStatus').textContent = 'Spremembe so le začasne. Shrani varnostno kopijo izbora.';
}

function persist() {
  if (!current) return;
  db.sessions[current.id] = current;
  db.latest = current.id;
  try {
    writeDatabase(localStorage, db);
    storageOkay = true;
    $('storageWarning').hidden = true;
    $('saveDot').classList.remove('unsaved');
    $('saveStatus').textContent = 'Izbor je shranjen v tem brskalniku · ' + new Date().toLocaleTimeString('sl-SI', {hour: '2-digit', minute: '2-digit'});
  } catch {
    storageWarning('Brskalnik trenutno ne more shraniti izbora (onemogočena ali polna shramba). Izbor je še odprt; prenesi varnostno kopijo JSON, preden zapreš stran.');
  }
}

function revokePhotos() {
  thumbnailGeneration++;
  queue = [];
  thumbObserver?.disconnect();
  for (const url of thumbs.values()) if (url) URL.revokeObjectURL(url);
  thumbs = new Map();
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null;
}

function renderCollections() {
  const select = $('collectionSelect');
  select.replaceChildren();
  for (const session of Object.values(db.sessions).sort((a,b) => b.updated - a.updated)) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = session.label + ' · ' + session.items.length + ' fotografij';
    option.selected = session.id === current?.id;
    select.append(option);
  }
}

function activate(session, linked = new Map()) {
  commitEdits();
  analysisEpoch++; cancelAnalysis = true;
  revokePhotos();
  current = {...session, analysis:session.analysis||{}, edits:session.edits||{}};
  files = linked;
  filter = 'all'; query = ''; proposal = null;
  $('searchInput').value = '';
  $('previewDialog').close();
  $('welcome').hidden = true;
  $('workspace').hidden = false;
  $('backupButton').disabled = false;
  persist();
  renderCollections();
  updateMetrics();
  renderGrid();
}

function updateMetrics() {
  const n = current?.selected.length || 0, target = current?.target || defaultTarget;
  $('selectedCount').textContent = n;
  $('filterCount').textContent = n;
  $('targetInput').value = target;
  $('selectionProgress').max = target;
  $('selectionProgress').value = Math.min(n, target);
  $('progressPercent').textContent = Math.round(n / target * 100) + ' %';
  $('progressLabel').textContent = n === 0 ? 'Tvoja fotoknjiga se začne s prvim izborom.' : n < target ? 'Še ' + (target - n) + ' do tvojega cilja.' : n === target ? 'Tvoj izbor je dosegel cilj. Lepi spomini!' : 'Cilj dosežen. Izbor lahko še izpopolniš.';
  $('undoButton').disabled = !current?.history.length;
  $('exportButton').disabled = n === 0;
  $('allCount').textContent = current?.items.length || 0;
  $('restoreBanner').hidden = !current || files.size > 0;
  if (current) $('collectionMeta').textContent = files.size ? files.size + ' lokalnih fotografij · brez prenosa na strežnik' : 'Fotografije čakajo na ponovno povezavo';
  $('allFilter').setAttribute('aria-pressed', filter === 'all');
  $('selectedFilter').setAttribute('aria-pressed', filter === 'selected');
  updateSmartMetrics();
  if ($('previewDialog').open) updatePreviewSelection();
}

function updateSmartMetrics() {
  if(!current)return;
  const analyzed=current.items.filter(i=>current.analysis[i.id]?.quality).length;
  const exif=current.items.filter(i=>current.analysis[i.id]?.source==='exif').length;
  const issues=current.items.filter(i=>qualityFlags(current.analysis[i.id]).length).length;
  const additions=proposal?.ids.filter(id=>!current.selected.includes(id))||[];
  $('analyzeButton').disabled=analyzing||loading||!files.size;
  $('analysisSummary').textContent=analyzed ? analyzed+' / '+current.items.length+' tehnično ocenjenih · '+exif+' datumov EXIF. Predlog dopolni izbor, obstoječe favorite ohrani.' : 'Lokalna analiza svetlosti, podrobnosti, ločljivosti in datumov. Obstoječi favoriti ostanejo izbrani.';
  $('dateSourceNote').textContent=exif+' datumov EXIF · ostali datumi iz datotek (lahko se razlikujejo od datuma posnetka).';
  $('issuesCount').textContent=issues;$('issuesFilter').hidden=!issues;
  $('proposalCount').textContent=proposal?.ids.length||0;$('proposalFilter').hidden=!proposal?.ids.length;
  $('proposalFilter').setAttribute('aria-pressed',filter==='proposal');$('issuesFilter').setAttribute('aria-pressed',filter==='issues');
  $('proposalBanner').hidden=!proposal;
  if(proposal){
    $('proposalSummary').textContent=additions.length ? 'Predlog: dodaj '+additions.length+' fotografij iz '+proposal.groups+' časovnih sklopov. Tvojih '+current.selected.length+' favoritov ostane izbranih.'+(proposal.filledWithSimilar?' Za dosego cilja je vključenih tudi '+proposal.filledWithSimilar+' podobnih posnetkov.':'') : current.selected.length>=current.target?'Tvoj izbor že dosega cilj. Za dodaten predlog zvišaj cilj.':'Za ta cilj ni več ocenjenih kandidatov. Nepodprte fotografije lahko izbereš ročno.';
    $('applyProposal').textContent='Dodaj '+additions.length+' predlaganih';$('applyProposal').disabled=!additions.length;
    $('reviewProposal').disabled=!proposal.ids.length;
  }
}

function visibleItems() {
  if (!current) return [];
  const chosen = new Set(current.selected);
  const term = query.trim().toLocaleLowerCase('sl');
  return current.items.filter(i => (filter === 'all' || filter==='selected'&&chosen.has(i.id) || filter==='proposal'&&proposal?.ids.includes(i.id) || filter==='issues'&&qualityFlags(current.analysis[i.id]).length) && (!term || i.path.toLocaleLowerCase('sl').includes(term)));
}

function paintCard(id) {
  const card = cards.get(id);
  if (!card) return;
  const chosen = current.selected.includes(id);
  card.article.classList.toggle('selected', chosen);
  card.article.classList.toggle('proposed', !chosen && !!proposal?.ids.includes(id));
  card.favorite.setAttribute('aria-pressed', chosen);
  card.favorite.setAttribute('aria-label', (chosen ? 'Odstrani iz izbora: ' : 'Izberi: ') + card.name);
  card.favorite.title = chosen ? 'Odstrani to fotografijo iz izbora' : 'Dodaj to fotografijo v izbor';
}

function toggle(id) {
  if (!current || loading) return;
  current = toggleFavorite(current, id);
  persist();
  updateMetrics();
  if (filter === 'selected') renderGrid(); else paintCard(id);
}

function undo() {
  if (!current?.history.length || loading) return;
  current = undoSelection(current);
  persist();
  updateMetrics();
  renderGrid();
  toast('Zadnja sprememba je razveljavljena.');
}

function renderGrid() {
  thumbObserver?.disconnect();
  queue = [];
  cards = new Map();
  const grid = $('photoGrid'), visible = visibleItems();
  const sequence = new Map(current.items.map((item, i) => [item.id, i + 1]));
  grid.replaceChildren();
  $('emptyResults').hidden = visible.length > 0;
  $('visibleLabel').textContent = visible.length + ' od ' + current.items.length + ' fotografij';
  $('emptyTitle').textContent = query ? 'Ni ujemajočih se fotografij.' : 'Tu bodo tvoji favoriti.';
  $('emptyDescription').textContent = query ? 'Poskusi drugo ime datoteke ali odstrani filter.' : 'Označi fotografijo z zvezdico in pojavila se bo tukaj.';
  if ('IntersectionObserver' in window) thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const node = entry.target;
      thumbObserver.unobserve(node);
      enqueueThumb(node.dataset.id, node);
    }
  }, {rootMargin: '500px'});
  const fragment = document.createDocumentFragment();
  const groups=dateSegments(visible,current.analysis,$('groupMode').value);
  for(const group of groups){
    if($('groupMode').value!=='none'){
      const heading=document.createElement('div');heading.className='day-heading';
      const title=document.createElement('strong');title.textContent=group.label;
      const count=document.createElement('span');count.textContent=group.items.length+' fotografij v tem pogledu';heading.append(title,count);fragment.append(heading);
    }
  for (const item of group.items) {
    const article = document.createElement('article'); article.className = 'photo-card';
    const open = document.createElement('button'); open.className = 'photo-open'; open.type = 'button'; open.setAttribute('aria-label', 'Odpri predogled: ' + item.name);
    const frame = document.createElement('span'); frame.className = 'photo-frame'; frame.dataset.id = item.id;
    const placeholder = document.createElement('span'); placeholder.className = 'photo-placeholder'; placeholder.append(icons('image'));
    const hint = document.createElement('span'); hint.textContent = files.has(item.id) ? 'Pripravljam predogled …' : 'Poveži izvorno mapo'; placeholder.append(hint); frame.append(placeholder);
    const number = document.createElement('span'); number.className = 'photo-number'; number.textContent = String(sequence.get(item.id)).padStart(3,'0'); frame.append(number);
    const caption = document.createElement('span'); caption.className = 'photo-caption';
    const name = document.createElement('strong'); name.textContent = item.name; name.title = item.name;
    const info = document.createElement('small'); const subfolder = item.relative.includes('/') ? item.relative.split('/').slice(0,-1).join('/') + ' · ' : ''; info.textContent = subfolder + (item.size / 1048576).toLocaleString('sl-SI', {maximumFractionDigits:1}) + ' MB'; info.title = item.path;
    caption.append(name, info); open.append(frame,caption);
    const tags=document.createElement('span');tags.className='photo-tags';
    const record=current.analysis[item.id];
    if(record?.quality){const score=document.createElement('span');score.className='quality-score';score.textContent='Ocena '+Math.round(record.quality.score)+'/100';score.title='Okvirna tehnična ocena svetlosti, podrobnosti in ločljivosti';tags.append(score);}
    for(const flag of qualityFlags(record)){const tag=document.createElement('span');tag.className='quality-tag';tag.textContent=flag;tags.append(tag);}
    if(hasEdits(current.edits[item.id])){const tag=document.createElement('span');tag.className='edit-tag';tag.textContent='Popravljeno';tags.append(tag);}
    if(proposal?.ids.includes(item.id)){const tag=document.createElement('span');tag.className='proposal-tag';tag.textContent='Predlog';tags.append(tag);}
    if(tags.childNodes.length)caption.append(tags);
    const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'favorite-button'; favorite.append(icons('star'));
    favorite.addEventListener('click', () => toggle(item.id));
    open.addEventListener('click', () => openPreview(item.id));
    article.append(open, favorite); fragment.append(article);
    cards.set(item.id, {article, favorite, name:item.name});
    paintCard(item.id);
    if (files.has(item.id)) {
      if (thumbs.has(item.id)) applyThumb(item.id, frame);
      else if (thumbObserver) thumbObserver.observe(frame);
      else enqueueThumb(item.id, frame);
    }
  }
  }
  grid.append(fragment);
}

function applyThumb(id, node) {
  node.querySelector('img')?.remove();
  const placeholder = node.querySelector('.photo-placeholder'), url = thumbs.get(id);
  if (url) {
    const image = document.createElement('img'); image.src = url; image.alt = ''; image.decoding = 'async';
    node.prepend(image); placeholder.hidden = true;
  } else {
    placeholder.lastChild.textContent = 'Predogled ni podprt. Izbor in kopiranje sta na voljo.';
  }
}

function enqueueThumb(id, node) {
  if (thumbs.has(id)) { applyThumb(id, node); return; }
  queue.push({id, node, generation: thumbnailGeneration, file: files.get(id)});
  pumpQueue();
}

async function makeThumbnail(file, edits) {
  let decoded, canvas;
  try {
    decoded=await decodeLocalPhoto(file);canvas=photoCanvas(decoded,680);editCanvasPixels(canvas,edits);
    return URL.createObjectURL(await canvasBlob(canvas,'image/jpeg',.82));
  } finally {
    decoded?.close();if(canvas)canvas.width=canvas.height=1;
  }
}

function pumpQueue() {
  while (activeJobs < 2 && queue.length) {
    const job = queue.shift();
    if (job.generation !== thumbnailGeneration || !job.file) continue;
    if (thumbs.has(job.id)) { applyThumb(job.id, job.node); continue; }
    activeJobs++;
    (async () => {
      let url = null;
      const signature=JSON.stringify(normalizeEdits(current.edits[job.id]));
      try { url = await makeThumbnail(job.file, current.edits[job.id]); } catch {}
      if (job.generation !== thumbnailGeneration) { if (url) URL.revokeObjectURL(url); return; }
      if(signature!==JSON.stringify(normalizeEdits(current.edits[job.id]))){if(url)URL.revokeObjectURL(url);const node=cards.get(job.id)?.article.querySelector('.photo-frame');if(node)enqueueThumb(job.id,node);return;}
      const old = thumbs.get(job.id); if (old) URL.revokeObjectURL(old);
      thumbs.set(job.id, url);
      if (job.node.isConnected) applyThumb(job.id, job.node);
      const currentFrame = cards.get(job.id)?.article.querySelector('.photo-frame');
      if (currentFrame && currentFrame !== job.node) applyThumb(job.id, currentFrame);
    })().finally(() => { activeJobs--; pumpQueue(); });
  }
}

async function loadFiles(list) {
  if (loading || copying || analyzing) return;
  loading = true;
  const openButtons = ['openFolderTop','openFolderWelcome','openFilesWelcome','openFilesButton','reconnectButton'];
  openButtons.forEach(id => $(id).disabled = true);
  try {
    const imageFiles = [...list].filter(f => f.type.startsWith('image/') && !/\.svg$/i.test(f.name) || IMAGE_PATTERN.test(f.name));
    if (!imageFiles.length) { toast('V izbrani mapi ni podprtih fotografij.'); return; }
    if (imageFiles.length > 20000) { toast('Naenkrat odpri največ 20.000 fotografij.'); return; }
    const linked = new Map(), items = [];
    for (const file of imageFiles) {
      const item = metadata(file);
      if (!linked.has(item.id)) { items.push(item); linked.set(item.id,file); }
    }
    items.sort((a,b) => collator.compare(a.path,b.path));
    const id = await collectionId(items);
    const root = imageFiles[0].webkitRelativePath?.split('/')[0];
    let session = db.sessions[id];
    if (!session) {
      session = newSession(id, items, root || 'Izbrane datoteke'); session.target = defaultTarget;
      // A changed folder is a new collection, but unchanged files keep their favorites.
      const itemIds = new Set(items.map(i => i.id));
      const related = Object.values(db.sessions).filter(s => s.label === session.label && s.items.some(i => itemIds.has(i.id))).sort((a,b) => b.updated - a.updated)[0];
      if (related) {
        session.selected = related.selected.filter(i => itemIds.has(i)); session.target = related.target;
        session.analysis=Object.fromEntries(Object.entries(related.analysis||{}).filter(([key])=>itemIds.has(key)));
        session.edits=Object.fromEntries(Object.entries(related.edits||{}).filter(([key])=>itemIds.has(key)));
        toast('Mapa je spremenjena. Ujemajoči favoriti so preneseni, prejšnji izbor ostaja v shranjeni zbirki.', 7000);
      }
    } else toast('Fotografije so povezane. Tvoj shranjeni izbor je pripravljen.');
    activate(session, linked);
    const special = items.filter(i => /\.(heic|heif|tiff?)$/i.test(i.name)).length;
    if (special) toast(special + ' fotografij HEIC/TIFF: če predogled ni podprt, uporabi kopije JPG.',7000);
  } catch (e) { toast('Fotografij ni bilo mogoče odpreti: ' + e.message,7000); }
  finally { loading = false; openButtons.forEach(id => $(id).disabled = false); updateMetrics(); }
}

async function runAnalysis(){
  if(!current||!files.size||analyzing||copying||loading)return;
  commitEdits();analyzing=true;cancelAnalysis=false;const epoch=++analysisEpoch, sessionId=current.id;
  $('analysisProgressBox').hidden=false;
  const locks=['openFolderTop','openFolderWelcome','openFilesWelcome','openFilesButton','reconnectButton','collectionSelect','importButton'];
  locks.forEach(id=>$(id).disabled=true);updateMetrics();
  thumbObserver?.disconnect();queue=[];
  const pending=current.items.filter(i=>!current.analysis[i.id]&&files.has(i.id));
  let cursor=0,done=current.items.length-pending.length;
  const report=()=>{$('analysisProgress').max=current.items.length;$('analysisProgress').value=done;$('analysisProgressText').textContent='Lokalna analiza: '+done+' / '+current.items.length+' · fotografije ostajajo na napravi';};
  report();
  async function worker(){
    while(cursor<pending.length&&!cancelAnalysis&&epoch===analysisEpoch){
      const item=pending[cursor++],record=await inspectLocalPhoto(files.get(item.id));
      if(current?.id!==sessionId||epoch!==analysisEpoch)return;
      current.analysis[item.id]=record;done++;report();
      if(done%10===0)persist();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  try{
    await Promise.all([worker(),worker()]);
    if(epoch!==analysisEpoch||current.id!==sessionId)return;
    persist();
    if(!cancelAnalysis){proposal=proposeSelection(current);toast('Analiza je zaključena. Predlog najprej preglej, nato ga dodaj izboru.',6500);}
    else toast('Analiza je ustavljena. Opravljene ocene so shranjene; naslednjič nadaljuješ.');
  }catch(e){toast('Analiza ni zaključena: '+e.message,6500);}
  finally{analyzing=false;locks.forEach(id=>$(id).disabled=false);$('analysisProgressBox').hidden=true;updateMetrics();if(current)renderGrid();}
}

function acceptProposal(){
  if(!proposal||!current)return;
  current=changeSelection(current,[...current.selected,...proposal.ids]);
  proposal=null;filter='selected';persist();updateMetrics();renderGrid();
  toast('Predlog je dodan. Celoten dodatek lahko razveljaviš z enim klikom.');
}

function openPreview(id) {
  previewIds = visibleItems().map(i => i.id);
  previewIndex = previewIds.indexOf(id);
  if (previewIndex < 0) return;
  showPreview();
  $('previewDialog').showModal();
}

function showPreview() {
  commitEdits();
  const item = current.items.find(i => i.id === previewIds[previewIndex]);
  if (!item) return;
  const image = $('previewImage'), message = $('previewMessage');
  previewPixels=null;comparingOriginal=false;$('editCanvas').hidden=true;$('editStatus').textContent='';
  image.onload = null; image.onerror = null;
  image.removeAttribute('src'); image.hidden = true;
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null;
  $('previewName').textContent = item.name;
  $('previewPosition').textContent = (previewIndex + 1) + ' / ' + previewIds.length + ' v trenutnem pogledu · ' + item.path;
  $('prevPhoto').disabled = previewIndex === 0;
  $('nextPhoto').disabled = previewIndex === previewIds.length - 1;
  message.hidden = false;
  if (files.has(item.id)) {
    message.textContent = 'Odpiram fotografijo …';
    const url = URL.createObjectURL(files.get(item.id)); previewURL = url;
    image.onload = () => {
      if (previewURL !== url)return;
      image.hidden=false;message.hidden=true;
      try{
        const canvas=photoCanvas({source:image,width:image.naturalWidth,height:image.naturalHeight},1400);
        previewPixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;
        renderEditPreview();
      }catch{$('editStatus').textContent='Predogleda popravkov ni bilo mogoče pripraviti.';}
      updateEditControls();
    };
    image.onerror = () => { if (previewURL === url) { image.hidden = true; message.textContent = 'Brskalnik ne more prikazati tega formata.\nFotografijo lahko vseeno izbereš in kopiraš. Za ogled uporabi kopijo JPG.'; } };
    image.alt = item.name; image.src = url;
  } else message.textContent = 'Tvoj izbor je shranjen.\nZa ogled fotografij zapri predogled in ponovno odpri isto izvorno mapo.';
  updateEditControls();
  updatePreviewSelection();
}

function currentPreviewId(){return previewIds[previewIndex];}

function updateEditControls(){
  const id=currentPreviewId(),edits=normalizeEdits(current?.edits[id]);
  for(const key of ['brightness','contrast','saturation','warmth']){
    $(key+'Slider').value=edits[key];$(key+'Value').textContent=edits[key]>0?'+'+edits[key]:edits[key];
    $(key+'Slider').disabled=!previewPixels||editingBusy;
  }
  $('editBadge').textContent=hasEdits(edits)?'Popravljeno':'Izvirnik';
  $('autoEditButton').disabled=!previewPixels||editingBusy;
  $('downloadEdited').disabled=!previewPixels||editingBusy;
  $('resetEdit').disabled=!hasEdits(edits)||editingBusy;
  $('compareOriginal').disabled=!hasEdits(edits)||!previewPixels;
  $('compareOriginal').setAttribute('aria-pressed',comparingOriginal);
  $('compareOriginal').textContent=comparingOriginal?'Pokaži popravke':'Pokaži izvirnik';
  const record=current?.analysis[id];
  $('qualityDescription').textContent=record?.quality ? record.width+' × '+record.height+' px · tehnična ocena '+Math.round(record.quality.score)+'/100 · '+(qualityFlags(record).join(', ')||'brez večjih opozoril')+' · '+(record.source==='exif'?'datum EXIF':'datum datoteke') : 'Za oceno kakovosti uporabi lokalno analizo. Samodejni popravek jo opravi za to sliko.';
}

function renderEditPreview(){
  if(!previewPixels)return;
  const edits=normalizeEdits(current.edits[currentPreviewId()]),canvas=$('editCanvas');
  const edited=hasEdits(edits)&&!comparingOriginal;
  canvas.hidden=!edited;$('previewImage').hidden=edited;
  if(edited){
    if(canvas.width!==previewPixels.width)canvas.width=previewPixels.width;
    if(canvas.height!==previewPixels.height)canvas.height=previewPixels.height;
    const image=new ImageData(new Uint8ClampedArray(previewPixels.data),previewPixels.width,previewPixels.height);
    applyPixelEdits(image.data,edits);canvas.getContext('2d').putImageData(image,0,0);
  }
}

function setPreviewEdits(edits){
  const id=currentPreviewId();if(!current||!id)return;
  const value=normalizeEdits(edits);
  current.edits[id]=value;current.updated=Date.now();dirtyEdits.add(id);comparingOriginal=false;
  cancelAnimationFrame(editFrame);editFrame=requestAnimationFrame(()=>{renderEditPreview();updateEditControls();});
}

function commitEdits(){
  if(!dirtyEdits.size||!current)return;
  for(const id of dirtyEdits){
    if(!hasEdits(current.edits[id]))delete current.edits[id];
    const url=thumbs.get(id);if(url)URL.revokeObjectURL(url);thumbs.delete(id);
  }
  dirtyEdits.clear();persist();
  if($('workspace')&&!$('workspace').hidden)renderGrid();
}

async function suggestEdit(){
  const id=currentPreviewId(),sessionId=current.id;
  if(!files.has(id)||editingBusy)return;
  editingBusy=true;updateEditControls();$('editStatus').textContent='Ocenjujem svetlost in kontrast …';
  try{
    if(!current.analysis[id]?.quality){
      const result=await inspectLocalPhoto(files.get(id));
      if(current?.id!==sessionId)return;
      current.analysis[id]=result;persist();updateMetrics();
    }
    if(currentPreviewId()!==id||!$('previewDialog').open)return;
    if(!current.analysis[id]?.quality)throw new Error('Ta format ni podprt za samodejni popravek.');
    setPreviewEdits(autoEdits(current.analysis[id]));commitEdits();
    $('editStatus').textContent='Predlagana sta zmerna svetlost in kontrast. Preveri primerjavo z izvirnikom.';
  }catch(e){$('editStatus').textContent=e.message;}
  finally{editingBusy=false;updateEditControls();}
}

async function downloadEditedPhoto(){
  const id=currentPreviewId(),item=current.items.find(i=>i.id===id),file=files.get(id),edits=normalizeEdits(current.edits[id]);
  if(!file||editingBusy)return;
  commitEdits();editingBusy=true;updateEditControls();$('editStatus').textContent='Pripravljam JPG v izvirnih dimenzijah …';
  try{
    const blob=await correctedPhoto(file,edits);
    download(blob,item.name+'.popravljeno.jpg','image/jpeg',false);
    if(currentPreviewId()===id)$('editStatus').textContent='Nova JPG je pripravljena za prenos. Izvirnik je ohranjen.';
  }catch(e){$('editStatus').textContent='Izvoz ni uspel: '+e.message;}
  finally{editingBusy=false;updateEditControls();}
}

function updatePreviewSelection() {
  const chosen = current.selected.includes(previewIds[previewIndex]);
  $('previewFavorite').setAttribute('aria-pressed', chosen);
  $('previewFavorite').querySelector('span').textContent = chosen ? 'Izbrana fotografija' : 'Izberi fotografijo';
  $('previewFavorite').title = chosen ? 'Klik odstrani le to fotografijo iz izbora' : 'Dodaj to fotografijo v izbor';
  $('previewSelectedCount').textContent = current.selected.length + ' / ' + current.target + ' izbranih';
}

function navigatePreview(offset) {
  const next = previewIndex + offset;
  if (next >= 0 && next < previewIds.length) { previewIndex = next; showPreview(); }
}

function download(contents, name, type = 'text/plain;charset=utf-8', bom = true) {
  const blob = new Blob(bom ? ['\ufeff', contents] : [contents], {type});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function saveBackup() {
  if (!current) return;
  download(backupText(current), 'fotoknjiga-izbor-' + new Date().toISOString().slice(0,10) + '.json', 'application/json', false);
  toast('Varnostna kopija izbora je pripravljena za prenos.');
}

function openExport() {
  commitEdits();
  if (!current?.selected.length) return;
  const count = current.selected.length;
  $('exportSummary').textContent = 'Izbranih: ' + count + ' od ' + current.items.length + ' fotografij. Fotografije in izvozi se obdelajo samo na tvoji napravi.';
  const linked = selectedItems(current).every(i => files.has(i.id));
  const editedCount=selectedItems(current).filter(i=>hasEdits(current.edits[i.id])).length;
  $('copyPhotosButton').disabled = !window.showDirectoryPicker || !linked;
  $('copyEditedButton').disabled=!window.showDirectoryPicker||!linked||!editedCount;
  $('editedExportHint').textContent=editedCount+' izbranih fotografij ima popravke. '+(!window.showDirectoryPicker?'Za kopiranje v mapo uporabi namizni Chrome/Edge; posamezno popravljeno JPG lahko preneseš v predogledu.':!linked?'Za kopiranje ponovno poveži izvorno mapo.':'Pri popravljenih JPG se metapodatki EXIF ne prenesejo. Seznami TXT in skript se nanašajo na izvirnike.');
  $('copyHint').textContent = !window.showDirectoryPicker ? 'Neposredno kopiranje tu ni na voljo. Odpri orodje v namiznem Edge/Chrome ali prenesi spodnji skript za Windows.' : !linked ? 'Za neposredno kopiranje najprej ponovno odpri izvorno mapo. Seznam in skript lahko preneseš že zdaj.' : 'Brskalnik bo prosil za dovoljenje za pisanje v izbrano ciljno mapo.';
  $('copyProgress').hidden = true;
  $('exportDialog').showModal();
}

async function directCopy(withEdits=false) {
  if (copying || !current?.selected.length) return;
  let destination;
  try { destination = await window.showDirectoryPicker({mode:'readwrite', id:'fotoknjiga-output'}); }
  catch (e) { if (e.name !== 'AbortError') toast('Mape ni bilo mogoče odpreti. Lahko uporabiš skript za Windows.'); return; }
  copying = true;
  const chosen = selectedItems(current), sourceFiles = new Map(files);
  const editSnapshot=structuredClone(current.edits);
  const buttons = [...$('exportDialog').querySelectorAll('button')].map(b=>({node:b,disabled:b.disabled}));
  buttons.forEach(b => b.node.disabled = true);
  $('copyProgress').hidden = false; $('copyProgress').textContent = 'Pripravljam kopiranje …';
  try {
    const transform=withEdits?async(item,file)=>hasEdits(editSnapshot[item.id])?{blob:await correctedPhoto(file,editSnapshot[item.id]),relative:item.relative+'.popravljeno.jpg'}:null:null;
    const result = await copyPhotos(chosen, sourceFiles, destination, (done,total) => { $('copyProgress').textContent = 'Kopiram fotografije: ' + done + ' / ' + total; },new Date(),transform);
    $('copyProgress').textContent = 'Kopirano: ' + result.copied + ' fotografij. Nova podmapa: ' + result.name + '. Izvirniki so ohranjeni.';
    toast('Tvoj izbor je kopiran v novo mapo.',6000);
  } catch(e) {
    $('copyProgress').textContent = 'Kopiranje ni zaključeno. ' + e.message + ' Delne kopije lahko ostanejo v novi podmapi; izvirniki so ohranjeni.';
  } finally { copying = false; buttons.forEach(b => b.node.disabled = b.disabled); }
}

function bind() {
  ['openFolderTop','openFolderWelcome','reconnectButton'].forEach(id => $(id).addEventListener('click', () => $('folderInput').click()));
  ['openFilesWelcome','openFilesButton'].forEach(id => $(id).addEventListener('click', () => $('filesInput').click()));
  for (const id of ['folderInput','filesInput']) $(id).addEventListener('change', e => { const list = [...e.target.files]; e.target.value = ''; if (list.length) loadFiles(list); });
  $('undoButton').addEventListener('click',undo);
  $('analyzeButton').addEventListener('click',runAnalysis);
  $('cancelAnalysis').addEventListener('click',()=>{cancelAnalysis=true;$('analysisProgressText').textContent='Ustavljam analizo po trenutnih fotografijah …';});
  $('applyProposal').addEventListener('click',acceptProposal);
  $('reviewProposal').addEventListener('click',()=>{filter='proposal';updateMetrics();renderGrid();});
  $('dismissProposal').addEventListener('click',()=>{proposal=null;if(filter==='proposal')filter='all';updateMetrics();renderGrid();});
  $('proposalFilter').addEventListener('click',()=>{filter='proposal';updateMetrics();renderGrid();});
  $('issuesFilter').addEventListener('click',()=>{filter='issues';updateMetrics();renderGrid();});
  $('groupMode').addEventListener('change',renderGrid);
  $('allFilter').addEventListener('click', () => { filter = 'all'; updateMetrics(); renderGrid(); });
  $('selectedFilter').addEventListener('click', () => { filter = 'selected'; updateMetrics(); renderGrid(); });
  $('searchInput').addEventListener('input',e => { query = e.target.value; renderGrid(); });
  $('gridSize').addEventListener('change',e => { $('photoGrid').className = 'photo-grid ' + e.target.value; });
  $('clearFilters').addEventListener('click',() => { filter = 'all'; query = ''; $('searchInput').value = ''; updateMetrics(); renderGrid(); });
  $('collectionSelect').addEventListener('change',e => { if (!copying) activate(db.sessions[e.target.value]); });
  $('targetInput').addEventListener('change',e => { defaultTarget = Math.max(1,Math.min(9999,Math.round(Number(e.target.value)||60))); if (current) { current = {...current,target:defaultTarget}; persist(); } updateMetrics(); });
  $('helpButton').addEventListener('click',() => $('helpDialog').showModal());
  $('closeHelp').addEventListener('click',() => $('helpDialog').close());
  $('exportButton').addEventListener('click',openExport);
  $('closeExport').addEventListener('click',() => { if (!copying) $('exportDialog').close(); });
  $('exportDialog').addEventListener('cancel',e => { if (copying) e.preventDefault(); });
  $('closePreview').addEventListener('click',() => $('previewDialog').close());
  $('previewDialog').addEventListener('close',() => { commitEdits();previewPixels=null;cancelAnimationFrame(editFrame);$('previewImage').removeAttribute('src'); if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; });
  $('prevPhoto').addEventListener('click',() => navigatePreview(-1));
  $('nextPhoto').addEventListener('click',() => navigatePreview(1));
  $('previewFavorite').addEventListener('click',() => toggle(previewIds[previewIndex]));
  $('downloadNames').addEventListener('click',() => download(selectedItems(current).map(i=>i.name).join('\r\n')+'\r\n','fotoknjiga-imena.txt'));
  $('downloadPaths').addEventListener('click',() => download(selectedItems(current).map(i=>i.relative).join('\r\n')+'\r\n','fotoknjiga-poti.txt'));
  $('downloadScript').addEventListener('click',() => { download(powershellScript(selectedItems(current),current.label),'kopiraj-fotoknjigo.ps1'); toast('Skript je pripravljen. V Windows ga odpri z možnostjo »Zaženi s PowerShell«.',7000); });
  $('copyPhotosButton').addEventListener('click',()=>directCopy(false));
  $('copyEditedButton').addEventListener('click',()=>directCopy(true));
  for(const key of ['brightness','contrast','saturation','warmth']){
    $(key+'Slider').addEventListener('input',e=>setPreviewEdits({...normalizeEdits(current.edits[currentPreviewId()]),[key]:Number(e.target.value)}));
    $(key+'Slider').addEventListener('change',commitEdits);
  }
  $('autoEditButton').addEventListener('click',suggestEdit);
  $('resetEdit').addEventListener('click',()=>{setPreviewEdits({});commitEdits();});
  $('compareOriginal').addEventListener('click',()=>{comparingOriginal=!comparingOriginal;renderEditPreview();updateEditControls();});
  $('downloadEdited').addEventListener('click',downloadEditedPhoto);
  $('backupButton').addEventListener('click',saveBackup);
  $('exportBackupLink').addEventListener('click',saveBackup);
  $('importButton').addEventListener('click',() => $('backupInput').click());
  $('backupInput').addEventListener('change',async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('Varnostna kopija je prevelika.'); return; }
    try {
      const restored = await parseBackup((await file.text()).replace(/^\uFEFF/,''));
      const existing = db.sessions[restored.id];
      const linked = current?.id === restored.id ? new Map(files) : new Map();
      const session = existing ? {...changeSelection(existing,restored.selected),target:restored.target,analysis:{...existing.analysis,...restored.analysis},edits:restored.edits} : restored;
      activate(session,linked);
      toast('Izbor je obnovljen. Za ogled po potrebi znova poveži izvorno mapo.',6500);
    } catch(e) { toast('Izbora ni bilo mogoče obnoviti: ' + e.message,7000); }
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (!$('helpDialog').open && !$('exportDialog').open) { e.preventDefault(); undo(); } return;
    }
    if (!$('previewDialog').open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePreview(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigatePreview(1); }
    if (e.key.toLowerCase() === 'f' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) toggle(previewIds[previewIndex]); }
  });
  window.addEventListener('beforeunload', e => { if(dirtyEdits.size)persist();if (copying || editingBusy || analyzing || !storageOkay && current?.selected.length) { e.preventDefault(); e.returnValue = ''; } });
  // Avoid a stale tab overwriting a newer selection from another tab.
  window.addEventListener('storage', e => {
    if (e.key !== 'fotoknjiga.studio.v1' || !e.newValue || loading || copying || analyzing || dirtyEdits.size) return;
    try {
      const fresh = readDatabase(localStorage); db = fresh;
      if (current && fresh.sessions[current.id]) { current = fresh.sessions[current.id]; updateMetrics(); renderGrid(); renderCollections(); toast('Izbor je posodobljen iz drugega zavihka.'); }
    } catch {}
  });
}

bind();
try {
  db = readDatabase(localStorage);
  if (db.latest && db.sessions[db.latest]) activate(db.sessions[db.latest]);
} catch {
  storageWarning('Lokalni izbor trenutno ni dostopen. Če imaš varnostno kopijo JSON, jo obnovi. Nov izbor lahko začneš z odpiranjem mape.');
}
