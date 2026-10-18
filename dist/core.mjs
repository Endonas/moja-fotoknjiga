import {sanitizeAnalysis, normalizeEdits, hasEdits} from './smart.mjs?v=1.2.1';
export const STORE_KEY = 'fotoknjiga.studio.v1';
export const IMAGE_PATTERN = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif|tiff?)$/i;
const MAX_ITEMS = 20000;

export function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || /[\\\0:]/.test(path)) throw new Error('Neveljavna pot fotografije.');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('Neveljavna pot fotografije.');
  return path;
}

export function metadata(file) {
  const path = safePath(file.webkitRelativePath || file.name);
  const relative = safePath(file.webkitRelativePath ? path.split('/').slice(1).join('/') : path);
  const item = {name: file.name, path, relative, size: file.size, modified: file.lastModified || 0};
  return {...item, id: JSON.stringify([item.path, item.size, item.modified])};
}

export async function collectionId(items) {
  const data = new TextEncoder().encode(items.map(x => x.id).sort().join('\n'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}

export function newSession(id, items, label) {
  return {id, label, items, selected: [], history: [], target: 60, analysis: {}, edits: {}, updated: Date.now()};
}

export function changeSelection(session, ids) {
  const known = new Set(session.items.map(i => i.id));
  const selected = [...new Set(ids)].filter(id => known.has(id));
  if (selected.length === session.selected.length && selected.every(id => session.selected.includes(id))) return session;
  const previous = new Set(session.selected), next = new Set(selected);
  const action = {added: selected.filter(id => !previous.has(id)), removed: session.selected.filter(id => !next.has(id))};
  return {...session, selected, history: [...session.history, action].slice(-100), updated: Date.now()};
}

export function toggleFavorite(session, id) {
  if (!session.items.some(i => i.id === id)) return session;
  const next = new Set(session.selected);
  next.has(id) ? next.delete(id) : next.add(id);
  return changeSelection(session, [...next]);
}

export function undoSelection(session) {
  if (!session.history.length) return session;
  const next = new Set(session.selected), action = session.history.at(-1);
  action.added.forEach(id => next.delete(id));
  action.removed.forEach(id => next.add(id));
  return {...session, selected: [...next], history: session.history.slice(0, -1), updated: Date.now()};
}

export function selectedItems(session) {
  const ids = new Set(session.selected);
  return session.items.filter(i => ids.has(i.id));
}

export function validateSession(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.id) || typeof value.label !== 'string' || !Array.isArray(value.items) || !value.items.length || value.items.length > MAX_ITEMS) throw new Error('Datoteka ne vsebuje veljavnega izbora.');
  const items = value.items.map(i => {
    if (!i || typeof i.name !== 'string' || !i.name || i.name.includes('/') || i.name.includes('\\') || !Number.isSafeInteger(i.size) || i.size < 0 || !Number.isSafeInteger(i.modified) || i.modified < 0) throw new Error('Neveljavni podatki fotografije.');
    const path = safePath(i.path), relative = safePath(i.relative);
    if (path.split('/').at(-1) !== i.name || relative.split('/').at(-1) !== i.name || !(path === relative || path.endsWith('/' + relative))) throw new Error('Pot fotografije se ne ujema z imenom.');
    const id = JSON.stringify([path, i.size, i.modified]);
    if (i.id !== id) throw new Error('Podatki fotografije se ne ujemajo.');
    return {name: i.name, path, relative, size: i.size, modified: i.modified, id};
  });
  const known = new Set(items.map(i => i.id));
  if (known.size !== items.length) throw new Error('Fotografije v zbirki se podvajajo.');
  if (!Array.isArray(value.selected) || value.selected.some(id => !known.has(id))) throw new Error('Izbor vsebuje neznano fotografijo.');
  const history = Array.isArray(value.history) ? value.history.slice(-100).filter(h => h && Array.isArray(h.added) && Array.isArray(h.removed) && [...h.added, ...h.removed].every(id => known.has(id))).map(h => ({added: [...new Set(h.added)], removed: [...new Set(h.removed)]})) : [];
  const analysis={},edits={};
  for(const id of known){
    const record=sanitizeAnalysis(value.analysis?.[id]);if(record)analysis[id]=record;
    if(value.edits?.[id]&&hasEdits(value.edits[id]))edits[id]=normalizeEdits(value.edits[id]);
  }
  return {id: value.id, label: value.label.slice(0, 160), items, selected: [...new Set(value.selected)], history, analysis, edits, target: Math.max(1, Math.min(9999, Math.round(Number(value.target) || 60))), updated: Number(value.updated) || Date.now()};
}

export function readDatabase(storage) {
  const raw = storage.getItem(STORE_KEY);
  if (!raw) return {version: 1, latest: null, sessions: {}};
  const db = JSON.parse(raw);
  if (db.version !== 1 || !db.sessions || typeof db.sessions !== 'object') throw new Error('Shranjeni podatki niso veljavni.');
  const sessions = {};
  for (const s of Object.values(db.sessions)) {
    const session = validateSession(s);
    sessions[session.id] = session;
  }
  return {version: 1, latest: sessions[db.latest] ? db.latest : null, sessions};
}

export function writeDatabase(storage, db) {
  storage.setItem(STORE_KEY, JSON.stringify(db));
}

export function backupText(session) {
  return JSON.stringify({type: 'fotoknjiga-selection', version: 1, session: {...session, history: []}}, null, 2);
}

export async function parseBackup(text) {
  const data = JSON.parse(text);
  if (data.type !== 'fotoknjiga-selection' || data.version !== 1) throw new Error('Izberi varnostno kopijo, ustvarjeno s tem orodjem (.json).');
  const session = validateSession(data.session);
  if (await collectionId(session.items) !== session.id) throw new Error('Varnostna kopija je poškodovana.');
  return session;
}

export function powershellScript(items, label) {
  if (!items.length) throw new Error('Najprej izberi fotografije.');
  const bytes = new TextEncoder().encode(JSON.stringify(items.map(i => safePath(i.relative))));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary);
  return `# Fotoknjiga: kopiranje izbranih fotografij. Izvirniki ostanejo nespremenjeni.\r\n# Zazeni skript v Windows PowerShell; nato vnesi pot do izvorne mape s fotografijami.\r\n$ErrorActionPreference = 'Stop'\r\n$paths = @(ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))))\r\n$source = (Read-Host 'Pot do izvorne mape (mapa, ki si jo odprl v orodju)').Trim().Trim('"')\r\nif (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'Izvorna mapa ne obstaja.' }\r\n$source = [IO.Path]::GetFullPath((Get-Item -LiteralPath $source).FullName)\r\n$prefix = $source.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar\r\n$resolved = @()\r\nforeach ($relative in $paths) {\r\n  $full = [IO.Path]::GetFullPath((Join-Path $source $relative))\r\n  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Neveljavna pot v izboru.' }\r\n  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('Manjka fotografija: ' + $relative) }\r\n  $resolved += [PSCustomObject]@{ Source = $full; Relative = $relative }\r\n}\r\n$base = Join-Path $source ('Fotoknjiga-izbor-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))\r\n$destination = $base\r\n$n = 1\r\nwhile (Test-Path -LiteralPath $destination) { $destination = $base + '-' + $n; $n++ }\r\n[IO.Directory]::CreateDirectory($destination) | Out-Null\r\nforeach ($entry in $resolved) {\r\n  $target = Join-Path $destination $entry.Relative\r\n  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null\r\n  Copy-Item -LiteralPath $entry.Source -Destination $target -ErrorAction Stop\r\n}\r\nWrite-Host ('Kopiranih fotografij: ' + $resolved.Count)\r\nWrite-Host ('Ciljna mapa: ' + $destination)\r\nRead-Host 'Pritisni Enter za konec'\r\n`;
}

export async function copyPhotos(items, fileMap, destination, onProgress = () => {}, stamp = new Date(), transform = null) {
  if (!items.length) throw new Error('Najprej izberi fotografije.');
  if (items.some(i => !fileMap.has(i.id))) throw new Error('Za kopiranje najprej ponovno poveži izvorno mapo.');
  items.forEach(i => safePath(i.relative));
  const base = (transform ? 'Fotoknjiga-popravki-' : 'Fotoknjiga-izbor-') + stamp.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  let name = base, suffix = 0;
  while (true) {
    try { await destination.getDirectoryHandle(name); name = base + '-' + (++suffix); }
    catch (e) { if (e.name === 'NotFoundError') break; throw e; }
  }
  const folder = await destination.getDirectoryHandle(name, {create: true});
  let copied = 0;
  const used = new Set();
  for (const item of items) {
    let writable;
    try {
      const original = fileMap.get(item.id);
      const output = transform ? await transform(item, original) : null;
      const path = safePath(output?.relative || item.relative), dot = path.lastIndexOf('.');
      let unique = path, number = 1;
      while (used.has(unique.toLocaleLowerCase())) {
        const split = dot > path.lastIndexOf('/') ? dot : path.length;
        unique = path.slice(0,split) + '-' + (++number) + path.slice(split);
      }
      used.add(unique.toLocaleLowerCase());
      let directory = folder;
      const parts = unique.split('/');
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, {create: true});
      const handle = await directory.getFileHandle(parts.at(-1), {create: true});
      writable = await handle.createWritable();
      await (output?.blob || original).stream().pipeTo(writable);
    } catch (e) {
      try { await writable?.abort(); } catch {}
      throw new Error('Kopiranih ' + copied + '/' + items.length + ' v ' + name + '. Težava pri ' + item.name + ': ' + e.message);
    }
    copied++;
    onProgress(copied, items.length);
  }
  return {name, copied};
}
