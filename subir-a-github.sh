#!/usr/bin/env bash
# Sube esta extensión a tu repositorio de GitHub, en la rama de trabajo.
# Uso: descomprime el zip, entra a la carpeta y ejecuta:  bash subir-a-github.sh
set -e
REPO="https://github.com/cvasquez-github/chrome-trapezoid-extenson.git"
BRANCH="claude/chrome-trapezoid-keystone-extension-eyvdka"
cd "$(dirname "$0")"
git init -q
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git add -A
git reset -q -- subir-a-github.sh 2>/dev/null || true   # no versionar este script
git commit -q -m "Extensión de corrección de keystone con trapecio WebGL" || true
git branch -M "$BRANCH"
git push -u origin "$BRANCH"
echo "Listo: rama '$BRANCH' subida a $REPO"
echo "Abre GitHub y crea el Pull Request hacia main si quieres fusionarla."
