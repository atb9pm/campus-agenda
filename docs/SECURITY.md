# Sécurité et protection des données

## Règles du dépôt

GitHub conserve le code, la documentation, les migrations de schéma et des exemples strictement fictifs. Il ne conserve jamais les données réelles de l'application.

Sont interdits dans le dépôt :

- noms ou coordonnées d'élèves ;
- codes d'accès actifs et identifiants réels ;
- devoirs, résultats ou informations scolaires réels ;
- mots de passe, jetons, clés et secrets ;
- bases locales, sauvegardes et exports.

## Principes d'implémentation

- Collecte minimale et pseudonymisation des accès élèves.
- Séparation stricte des données par classe.
- Permissions contrôlées côté serveur.
- Secrets fournis par l'environnement d'exécution.
- Journalisation sans contenu scolaire sensible.
- Suppression et rotation possibles des codes d'accès.

## Avant chaque publication

1. Examiner les fichiers ajoutés et modifiés.
2. Rechercher les secrets et données personnelles.
3. Vérifier qu'aucun fichier de base, export ou sauvegarde n'est suivi.
4. Utiliser seulement des données de démonstration clairement fictives dans les tests.

