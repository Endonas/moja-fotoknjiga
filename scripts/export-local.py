#!/usr/bin/env python3
"""Build one file://-compatible HTML without external resources or module imports."""
from pathlib import Path
import argparse
import base64
import hashlib
import re

parser=argparse.ArgumentParser()
parser.add_argument('output',type=Path)
args=parser.parse_args()
source=Path(__file__).resolve().parents[1]/'dist'
html=(source/'index.html').read_text()
css='\n'+(source/'style.css').read_text()+'\n'
parts=[]
for name in ['smart.mjs','core.mjs','imaging.mjs','app.mjs']:
    code=re.sub(r'^import[^\n]+\n','',(source/name).read_text(),flags=re.M)
    parts.append(re.sub(r'^export\s+','',code,flags=re.M))
script="\n'use strict';\n(() => {\n"+'\n'.join(parts)+'\n})();\n'
assert not re.search(r'</script',script,re.I)
assert not re.search(r'</style',css,re.I)
digest=lambda s:base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()
csp="default-src 'none'; script-src 'sha256-"+digest(script)+"'; style-src 'sha256-"+digest(css)+"'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
html=re.sub(r'(<meta http-equiv="Content-Security-Policy" content=")[^"]+(">)',lambda m:m[1]+csp+m[2],html)
html,count=re.subn(r'<link rel="stylesheet" href="\./style\.css(?:\?[^"]*)?">',lambda m:'<style>'+css+'</style>',html)
assert count==1
html,count=re.subn(r'<script type="module" src="\./app\.mjs(?:\?[^"]*)?"></script>','',html)
assert count==1
html=html.replace('href="./favicon.svg"','href="data:image/svg+xml;base64,'+base64.b64encode((source/'favicon.svg').read_bytes()).decode()+'"')
html=html.replace('class="brand" href="./"','class="brand" href="#"')
html=re.sub(r'<title>[^<]*</title>','<title>Moja fotoknjiga · lokalna različica v1.2.1</title>',html,count=1)
html=html.replace('<div class="help-content">','<div class="help-content"><p><strong>Lokalna različica:</strong> Ta datoteka deluje brez interneta in brez namestitve. Odpiraj jo v istem profilu Google Chrome in jo ohrani na istem mestu. Občasno prenesi varnostno kopijo izbora. Za prenos favoritov iz spletne različice tam klikni »Varnostna kopija«, nato tukaj »Obnovi izbor«.</p>')
html=html.replace('Ni nalaganja na strežnik.','Orodje deluje tudi brez interneta, fotografije ostanejo pri tebi.')
html=html.replace('</body>','<script>'+script+'</script>\n</body>')
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(html)
print(args.output.resolve())
