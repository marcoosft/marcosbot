#!/bin/bash
# Sincroniza os painéis do repo claudio-paineis para este site (marcosbot).
# Uso: bash sync.sh            -> só copia e transforma
#      bash sync.sh --push     -> copia, commita e publica
set -e
cd "$(dirname "$0")"
SRC="../claudio-paineis"

# URLs dos Apps Script chumbadas no site (deixe vazio para exigir config manual)
FP_URL="https://script.google.com/macros/s/AKfycbwkzfA3igBdcnIfQBAKD_dr6BAS5bqd-f9-LeeEuTE8E-06RrBtZvcSxwpeSH6byir2/exec"
TS_URL=""
CJ_URL=""

GUARD="<script>if(localStorage.getItem('mb_auth')!=='ok903092')location.replace('../');</script>"

copia() { # copia <origem> <destino> <chave-localStorage> <url-default>
  cp "$SRC/$1" "$2"
  sed -i "s#\.\./painel-central/painel-central\.html#../#g" "$2"
  sed -i "s#</head>#$GUARD</head>#" "$2"
  if [ -n "$4" ]; then
    sed -i "s#localStorage.getItem('$3') || ''#localStorage.getItem('$3') || '$4'#" "$2"
  fi
}

copia "financas-pessoais/financas-pessoais.html" "financas/index.html"   "fp_url" "$FP_URL"
copia "tesourinha/tesourinha.html"               "tesourinha/index.html" "ts_url" "$TS_URL"
copia "painel-jornalismo/painel-jornalismo.html" "editorial/index.html"  "cj_script_url" "$CJ_URL"

echo "Painéis sincronizados."

if [ "$1" = "--push" ]; then
  git add -A
  git commit -m "Sincroniza painéis do claudio-paineis" || echo "Nada para commitar."
  git push
  echo "Publicado."
fi
