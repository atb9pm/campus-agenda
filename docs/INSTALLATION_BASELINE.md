# Baseline d’installation — Campus Agenda 2.61.8

Campus Agenda est un **produit unique**. Les données d’un établissement **ne font pas partie du produit**.

Cette baseline formalise ce qu’est une installation propre de la version **2.61.8**, afin de pouvoir plus tard installer le même logiciel pour d’autres établissements, chacun avec sa propre instance.

## Produit et données

Le dépôt GitHub contient le code, le schéma, les migrations et la documentation. Il ne contient jamais :

- les données scolaires d’un établissement ;
- les secrets d’exploitation ;
- les sauvegardes réelles.

Chaque établissement doit avoir :

- son propre domaine ;
- sa propre base SQLite ;
- ses propres secrets (`AUTH_SECRET`, `CAMPUS_MFA_ENCRYPTION_KEY`, mot de passe administrateur, etc.) ;
- sa propre configuration scolaire ;
- ses propres enseignants, classes, horaires, accès élèves et contenus pédagogiques.

## Modèle recommandé

```text
1 établissement = 1 installation Campus Agenda = 1 base SQLite
```

Il ne faut **pas** pour l’instant créer un système multi-écoles dans une seule base.

Une nouvelle école = une nouvelle installation (domaine, SQLite, secrets, configuration), pas un second locataire dans la base existante.

## Démarrage sur base vierge

Une installation propre de 2.61.8, sur un fichier SQLite nouveau ou vide, doit donner :

1. les **migrations** appliquées (schéma à jour) ;
2. un **administrateur initial** créé au bootstrap (`CAMPUS_ADMIN_PASSWORD` obligatoire si la base est totalement vide) ;
3. **aucune donnée métier de démonstration** ;
4. zéro classe ;
5. zéro cours (`AnnualCourse`) ;
6. zéro devoir ;
7. zéro contrôle.

`CAMPUS_DEMO_SEED` et `DEMO_CATALOG` n’alimentent **jamais** l’UI de production. Le seed de démonstration n’existe que pour les tests, fixtures et développement local.

La configuration scolaire se fait ensuite depuis **Administration** : année, calendrier, professions, classes, enseignants, attributions, horaires, accès élèves.

Référence opérationnelle : [Exploitation](OPERATIONS.md) (procédure de base vierge, sauvegardes v4).

## Séparation des environnements

Les deux environnements actuellement exploités pour Campus Agenda sont **indépendants**.

### PRODUCTION

| Élément | Valeur |
|---|---|
| Domaine | `campusagenda.ch` |
| Branche Git | `main` |
| Base | SQLite **PROD** (`CAMPUS_SQLITE_PATH` de production) |
| Secrets | secrets **PROD** |

### TEST / STAGING

| Élément | Valeur |
|---|---|
| Domaine | `test.campusagenda.ch` |
| Branche Git | `staging` |
| Base | SQLite **TEST** |
| Secrets | secrets **TEST** |

Les deux environnements **ne doivent jamais** partager directement :

- le même fichier SQLite ;
- les mêmes secrets (`AUTH_SECRET`, `CAMPUS_MFA_ENCRYPTION_KEY`, mot de passe administrateur).

Un test de restauration copie un **fichier de sauvegarde** v4 vers TEST, pas le fichier SQLite de production ni les secrets de production.

## Validation d’une version installable

Avant de considérer une version comme installable (et, plus tard, de poser un tag `vX.Y.Z`) :

1. **Démarrage sur base vierge** — nouveau fichier SQLite, migrations, admin bootstrap.
2. **Aucune donnée de démonstration** — pas de classes, cours, devoirs ni contrôles inventés.
3. **Sauvegarde v4 de production** — téléchargée depuis Administration → Sauvegarde des données (fichier hors Git).
4. **Restauration sur TEST** — restaurer ce fichier sur `test.campusagenda.ch` (base TEST, secrets TEST).
5. **Vérification** sur TEST :
   - année scolaire active ;
   - classes ;
   - enseignants ;
   - AnnualCourse ;
   - attributions ;
   - horaires ;
   - Ma semaine ;
   - Carnet ;
   - contrôles ;
   - export PDF.
6. **Nettoyage du TEST** après un essai avec des données réelles : ne pas laisser une copie de production sur TEST plus longtemps que nécessaire. Revenir à une base TEST vierge ou à un jeu de test non scolaire.

Ne jamais versionner le fichier de sauvegarde dans Git.

## Note MFA

Le backup **v4** peut contenir la table `teacher_mfa` (secret TOTP chiffré, empreintes de codes de récupération).

Une restauration sur TEST qui utilise une **autre** `CAMPUS_MFA_ENCRYPTION_KEY` que celle de production rend ces secrets illisibles (fermeture sécurisée). Dans ce cas, réinitialiser la 2FA **sur le TEST** (`pnpm admin:reset-2fa`, puis nouvel enrôlement).

**Ne jamais** copier automatiquement la clé MFA de production vers le TEST.

La procédure détaillée (même environnement, même clé, ou reset si la clé est perdue) reste dans [Exploitation](OPERATIONS.md).

## Baseline 2.61.8

La version **2.61.8** constitue la première baseline d’installation formalisée, avec :

- runtime **Node.js** sur Infomaniak ;
- persistance **SQLite** ;
- installation sur **base vierge** ;
- **administrateur initial** au bootstrap ;
- **aucune donnée scolaire de démonstration** en production ;
- **AnnualCourse** comme contexte enseignant (jamais la classe seule) ;
- **CourseSession** calculée (pas de table SQL) ;
- sauvegarde / restauration **v4**.

Le tag Git `v2.61.8` n’est créé qu’après validation et merge sur `main`. Cette documentation ne pose pas le tag.
