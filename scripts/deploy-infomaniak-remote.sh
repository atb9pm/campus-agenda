#!/usr/bin/env bash
# Déploiement sur Infomaniak (exécuté en SSH depuis GitHub Actions).
# Prérequis : clone Git du dépôt sur le serveur, npm disponible, dossier web/.
set -euo pipefail

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SITE_DIR="${INFOMANIAK_SITE_DIR:?Définir INFOMANIAK_SITE_DIR (racine du clone Git sur Infomaniak)}"

echo "==> Campus Agenda — déploiement Infomaniak"
echo "    Branche : origin/${DEPLOY_BRANCH}"
echo "    Dossier : ${SITE_DIR}"

cd "${SITE_DIR}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ ${SITE_DIR} n'est pas un dépôt Git."
  exit 1
fi

git fetch origin "${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"

cd web
npm install
npm run build

echo "✓ Build terminé ($(git -C .. rev-parse --short HEAD))"
