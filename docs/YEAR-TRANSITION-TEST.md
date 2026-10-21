# Transfert annuel — validation sur test.campusagenda.ch

## État réel

PR3.1–PR3.3 : moteur d'aperçu persisté, correspondances explicites de classes,
placement par référence pédagogique et application atomique des publications.
PR3.4 (#163) : normalisation et sauvegarde des notes privées du Carnet.
PR3.5 (cette branche) : inclusion facultative des notes d'un propriétaire dans
le même aperçu et la même transaction que les publications.

Le site n'a pas encore d'écran ni de route HTTP de transfert annuel.
Le script serveur ci-dessous permet de tester le parcours complet sans attendre
cet écran. La branche part de `96e0e6a` ; aucun merge dans `main` n'est nécessaire.

## Règles des notes

- `includePrivateNotes` vaut false par défaut. Un propriétaire explicite est requis.
- Copie indépendante : texte riche, auteur et propriétaire conservés ; provenance
  sourceNoteId/sourceSchoolYearId, horodatage et nouvel identifiant.
- La séance N+1 provient de la position d'une référence pédagogique dans le
  parcours CTX, puis d'une séance réelle du cours cible. Jamais une semaine/date
  copiée depuis N.
- Une référence existante de la note peut être utilisée. À défaut, seules les
  publications de la même séance source peuvent établir une référence unique.
- NO_REFERENCE et NO_CONTINUATION sont signalés et laissés dans N. Les conflits
  de correspondance, de référence ou de cible bloquent tout APPLY.
- Les documents legacy non résolus (V1, pendingWeeks, orphanedSessions) restent
  dans `teacher_notes` ; ils ne font pas partie de ce transfert. Charger le Carnet
  source avant l'aperçu permet de normaliser les notes résolubles.
- Un changement matériel de notes après l'aperçu exige un nouvel aperçu. Une
  vérification supplémentaire dans la transaction protège contre une écriture
  concurrente. Notes, publications et journal sont validés ou annulés ensemble.
- Un nouvel APPLY du même aperçu ne crée pas de doublons. Un nouvel aperçu
  reconnaît les copies existantes par propriétaire + année + sourceNoteId.
- Moteur version 2 : les anciens aperçus non appliqués doivent être recalculés.

## Procédure serveur (à confier à Cursor)

1. Utiliser uniquement l'environnement et la base de **test.campusagenda.ch**.
   Sauvegarder cette base et relever le commit déployé.
2. Déployer cette branche et ouvrir le Carnet de l'enseignant source afin de
   normaliser ses notes. Préparer une année cible **brouillon**, ses classes,
   cours, affectations et horaires réels, ainsi que les adaptateurs agenda.
3. Depuis `web/`, avec les mêmes variables de base de données que le site :

   ```sh
   node --experimental-strip-types ../scripts/year-transition.ts inspect
   ```

4. Créer hors du dossier public un fichier `transition-test.json` avec les vrais
   identifiants relevés. Exemple de structure (remplacer toutes les valeurs) :

   ```json
   {
     "sourceSchoolYearId": "ID_ANNEE_N",
     "targetSchoolYearId": "ID_ANNEE_N1",
     "classMappings": [{ "sourceClassId": "ID_CLASSE_N", "targetClassId": "ID_CLASSE_N1" }],
     "includePrivateNotes": true,
     "privateNotesOwnerTeacherId": "ID_ENSEIGNANT"
   }
   ```

5. Générer l'aperçu (aucune copie de note/publication à cette étape) :

   ```sh
   node --experimental-strip-types ../scripts/year-transition.ts preview transition-test.json
   ```

   Vérifier les séances cibles et les motifs de chaque ligne. S'il y a un motif
   bloquant, corriger la préparation et générer un nouvel aperçu. Les notes sans
   référence ne sont pas transférées : vérifier explicitement leur liste.

6. Appliquer l'identifiant retourné après avoir contrôlé l'aperçu :

   ```sh
   node --experimental-strip-types ../scripts/year-transition.ts apply ID_TRANSITION
   ```

7. Dans le site, consulter le cours cible avec le même enseignant : notes à la
   bonne séance, ordre et mise en forme conservés. Recharger, modifier une copie,
   puis vérifier que la note de N n'a pas changé. Un autre enseignant et un élève
   ne doivent pas voir les notes privées. L'année cible reste en brouillon.
8. Relancer exactement le même APPLY : ALREADY_APPLIED, aucun doublon. Générer
   aussi un nouvel aperçu : les copies y sont ALREADY_PRESENT.

Cette validation n'active pas l'année cible et ne déploie rien en production.
L'écran administrateur et la sélection des correspondances dans l'interface
restent une étape distincte à construire après validation du moteur.
