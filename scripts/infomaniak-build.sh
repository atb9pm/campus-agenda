#!/usr/bin/env bash
# Commande de build unique pour l'hébergement Node.js Infomaniak.
#
# À coller UNE SEULE FOIS dans Manager → Node.js → Commande de build :
#
#   bash scripts/infomaniak-build.sh
#
# Ensuite, chaque mise à jour se fait par Pull Request → merge sur main →
# bouton « Build » puis « Redémarrer ». La logique de déploiement vit dans ce
# fichier : elle évolue avec le dépôt, plus jamais dans le Manager.
#
# Le corps est encapsulé dans une fonction pour que bash ait lu tout le script
# avant que `git reset` ne le remplace sur le disque.

set -euo pipefail

main() {
  local branch="${DEPLOY_BRANCH:-main}"
  local stage="${CAMPUS_DEPLOY_STAGE:-update}"
  local script_dir root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  root="$(cd "${script_dir}/.." && pwd)"

  cd "${root}"

  if [ "${stage}" = "update" ]; then
    echo "==> Campus Agenda — build Infomaniak"
    echo "    Dépôt   : ${root}"
    echo "    Branche : origin/${branch}"

    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      # Le clone appartient parfois à un autre utilisateur système chez Infomaniak.
      git config --global --add safe.directory "${root}" 2>/dev/null || true
    fi

    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "❌ ${root} n'est pas un dépôt Git : impossible de récupérer le code."
      echo "   Vérifiez le champ « Dossier d'exécution » (racine du clone) dans le Manager."
      return 1
    fi

    git fetch origin "${branch}"
    git checkout -B "${branch}" "origin/${branch}"
    git reset --hard "origin/${branch}"

    echo "    Commit  : $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

    # Nouveau processus : les étapes ci-dessous viennent du code fraîchement récupéré.
    CAMPUS_DEPLOY_STAGE=install exec bash "${root}/scripts/infomaniak-build.sh"
  fi

  cd "${root}/web"

  echo "==> Dépendances (npm)"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi

  echo "==> Build"
  npm run build

  echo "==> Empreinte de déploiement"
  node -e '
    const { writeFileSync, readFileSync } = require("node:fs");
    const { execSync } = require("node:child_process");
    const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const info = {
      version,
      commit: git("rev-parse HEAD"),
      shortCommit: git("rev-parse --short HEAD"),
      branch: git("rev-parse --abbrev-ref HEAD"),
      committedAt: git("log -1 --pretty=%cI"),
      builtAt: new Date().toISOString(),
    };
    writeFileSync("build-info.json", `${JSON.stringify(info, null, 2)}\n`);
    console.log(`    ${info.version} · ${info.shortCommit} · ${info.builtAt}`);
  '

  echo ""
  echo "✓ Build terminé. Cliquez maintenant sur « Redémarrer » dans le Manager."
  echo "  Vérification : https://campusagenda.ch/api/health"
  echo ""
  echo "  Rappel — commande de lancement attendue :"
  echo "  cd web && AUTH_SECRET=votre-secret CAMPUS_STORE=sqlite npm run start:infomaniak"
}

main "$@"; exit 0
