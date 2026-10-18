# Moja fotoknjiga

**Zasebno orodje za izbor fotografij za fotoknjigo, ki deluje neposredno v brskalniku in tudi brez interneta.**

Iz več sto fotografij pregledno izberi približno 60 najljubših. Pregleduj velike predoglede, označuj favorite, uporabi lokalni predlog izbora in po potrebi prilagodi fotografije. Klik v prazno ne odznači celotnega izbora.

**Različica: v1.2.1 · Uporabniški vmesnik: slovenščina · Brez zunanjih odvisnosti**

## Hiter začetek

1. Prenesi repozitorij: **Code → Download ZIP**, nato ga razširi.
2. Datoteko **[Moja-fotoknjiga.html](Moja-fotoknjiga.html)** odpri z Google Chrome ali Microsoft Edge.
3. Klikni **Odpri mapo** in izberi mapo s fotografijami.
4. S klikom na sliko odpri velik predogled. Z zvezdico izbereš samo posamezno fotografijo.
5. V zavihku **Izbrane** preveri izbor in ga izvozi.

Namestitev, uporabniški račun in internetna povezava za lokalno različico niso potrebni. Če brskalnik ob izbiri mape uporabi izraz »naloži«, aplikacija fotografij kljub temu ne pošilja na strežnik.

## Funkcije

| Področje | Kaj omogoča |
| --- | --- |
| Pregled fotografij | Tri velikosti mreže, velik predogled, iskanje po imenu ali poti, pomikanje s tipkovnico. |
| Izbor | Favoriti, nastavljiv cilj, števec, filter izbranih in do 100 razveljavitev. |
| Shranjevanje | Samodejno lokalno shranjevanje izbora in nastavitev popravkov ter varnostna kopija JSON. |
| Časovna razporeditev | Skupine po dnevih ali časovnih sklopih; nov sklop po več kot 90 minutah premora. |
| Predlog izbora | Tehnična ocena svetlosti, podrobnosti, kontrasta in ločljivosti, zastopanost časovnih sklopov ter omejevanje podobnih zaporednih posnetkov. |
| Popravki | Svetlost, kontrast, nasičenost, toplina, zmeren samodejni predlog in primerjava z izvirnikom. |
| Izvoz | Imena ali relativne poti TXT, kopiranje izvirnikov, nove popravljene JPG in skript PowerShell za Windows. |

## Predlog izbora

Izberi **Analiziraj in predlagaj → Preglej predlog → Dodaj predlagane**. Analiza sama ne spreminja favoritov. Potrjen predlog dopolni obstoječi izbor do cilja in ga je mogoče razveljaviti z eno potezo.

Ocene so lokalne, deterministične ocene tehničnih lastnosti slike. Orodje ne uporablja oblačne umetne inteligence in ne presoja izrazov na obrazih, kompozicije ali pomena trenutka. Oznaka »Malo podrobnosti« lahko pomeni tudi namerno mehko ozadje. Podobnost posnetkov je okvirna ocena, ne dokaz podvojene datoteke.

Za datum posnetka se uporabi EXIF, kadar je dostopen v JPEG, PNG z EXIF ali TIFF. Sicer se uporabi datum spremembe datoteke, kar je v vmesniku označeno. Pri kopiranih datotekah se lahko ta datum razlikuje od datuma posnetka.

## Popravki in izvoz

V velikem predogledu prilagodi drsnike ali izberi **Predlagaj popravek**. **Pokaži izvirnik** omogoči primerjavo. Nastavitve popravkov se shranijo ločeno od datotek.

- **Prenesi popravljeno JPG** ustvari novo JPG v izvirnih dimenzijah.
- **Kopiraj izbor s popravki** v novo podmapo shrani popravljene fotografije kot JPG, preostale pa kopira kot izvirnike.
- **Kopiraj izbrane fotografije** in skript PowerShell kopirata izvirne datoteke.
- TXT seznami vsebujejo imena oziroma poti izvirnih datotek.

Izvirne fotografije ostanejo ohranjene. V popravljene kopije JPG se metapodatki EXIF ne prenesejo. S svetlostjo in kontrastom ni mogoče obnoviti izgubljene ostrine ali povsem izgubljenih podrobnosti.

## Zasebnost in nadaljevanje dela

Fotografije se obdelujejo na tvoji napravi. Ni prenosa slik na strežnik, analitike, zunanjih pisav ali zunanjih skript. Omrežne povezave aplikacije blokira tudi Content Security Policy.

V `localStorage` se shranijo imena, relativne poti, podatki o datotekah, datumi, ocene, favoriti, zgodovina izbora in nastavitve popravkov. Same fotografije ostanejo v izvorni mapi.

Ob ponovnem odprtju izberi isto mapo, da znova povežeš slike. Za nadaljevanje uporabljaj isti brskalnik, profil in lokacijo lokalne datoteke HTML. Pred menjavo brskalnika, premikom aplikacije ali brisanjem podatkov strani shrani **Varnostno kopijo** in jo nato uvozi z **Obnovi izbor**. Varnostne kopije vsebujejo imena in podatke o fotografijah; hrani jih pri sebi.

Ta repozitorij vsebuje aplikacijo in sintetične teste. Osebne fotografije in uporabnikovi izbori niso vključeni.

## Podprti brskalniki in formati

Za najboljšo podporo uporabi namizni Chrome ali Edge. Neposredno kopiranje v mapo je odvisno od podpore brskalnika za File System Access API in dovoljenja za pisanje. Kot alternativa sta na voljo TXT in skript PowerShell; posamezno popravljeno JPG je mogoče prenesti v predogledu.

JPG, PNG, WebP, AVIF, GIF in BMP se prikažejo, kadar jih podpira brskalnik. Pri HEIC in TIFF predogled ali analiza morda nista na voljo; za pregled pripravi kopije JPG. Nepodprte datoteke je še vedno mogoče izbrati in kopirati, samodejni predlog pa jim ne pripisuje izmišljene ocene kakovosti.

## Tipkovnica

| Bližnjica | Dejanje |
| --- | --- |
| `←` / `→` | Prejšnja / naslednja fotografija v predogledu. |
| `F` ali preslednica | Dodaj ali odstrani posamezno fotografijo iz izbora. |
| `Ctrl + Z` / `Cmd + Z` | Razveljavi spremembo izbora. |
| `Esc` | Zapri predogled ali pogovorno okno. |

## Razvoj in preverjanje

Vsebuje navaden HTML, CSS in JavaScript module. Za aplikacijo ni treba namestiti paketov.

```text
Moja-fotoknjiga.html       Samostojna lokalna različica
dist/                     HTML, CSS in izvorni JavaScript moduli za statično gostovanje
scripts/export-local.py   Izdelava samostojne datoteke HTML
tests/                    Testi logike, izvoza in toka dogodkov
```

Za razvojno strežbo iz korenske mape uporabi Python:

```bash
python3 -m http.server 8000 --directory dist
```

Nato odpri `http://localhost:8000`. Za uporabo z dvoklikom uporabi samostojno datoteko HTML; izvorni moduli v `dist/` zahtevajo spletni strežnik.

Testi se izvajajo z Node.js 22 ali novejšim:

```bash
node --test tests/*.test.mjs
```

Izdelava samostojne različice zahteva Python 3:

```bash
python3 scripts/export-local.py Moja-fotoknjiga.html
```

Samostojna datoteka vsebuje vse sloge, skripte in ikono ter izračunane CSP hashe. Ob spremembah izvornih datotek jo ponovno ustvari.

V različici v1.2.1 je uspešnih 22 avtomatiziranih preverjanj. Vključujejo zbirko 377 fotografij, izbor 60, obnovitev izbora in popravkov, razveljavitev, branje EXIF, časovne skupine, tehnične ocene in kopiranje brez prepisovanja izvirnikov. Test toka dogodkov uporablja simulacijo DOM/canvas; ne nadomesti vizualnega preverjanja, resničnih slikovnih kodekov ali sistemskih oken za dovoljenja v brskalniku.

---

**English:** A local-first photo book selector with persistent favorites, chronological grouping, technical quality suggestions, non-destructive adjustments and export. Photos are processed in the browser and are never uploaded. The interface and usage instructions are in Slovenian.
