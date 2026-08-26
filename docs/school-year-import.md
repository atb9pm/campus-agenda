# Import du plan des semaines A/B (PDF)

## Format recevable

Campus Agenda accepte le **PDF officiel du secrétariat** tel que fourni chaque année, par exemple :

`Semaines A-B 26-27.pdf` — calendrier **Août → Juin**, titre **« Année scolaire 2026-2027 »**, numéros de semaine **01 à 38** dans les cases du calendrier.

Ce format est **recevable en début d'année** pour préparer ou mettre à jour l'année scolaire sans modification du code.

## Interface enseignant

Menu **Paramètres → Année scolaire** :

1. Choisir le PDF des semaines A/B
2. Vérifier l’aperçu (badge « PDF recevable », tableau des 38 semaines)
3. **Enregistrer en brouillon**, puis **Activer cette année**

## Workflow admin (API)

1. **Analyser** — `POST /api/admin/school-year/parse` (multipart, champ `file`)  
   Retourne `receivable: true` si 38 semaines sont extraites sans erreur.

2. **Importer** — `POST /api/admin/school-year/import`  
   Crée une année en statut **brouillon** + aperçu des semaines.

3. **Activer** — `POST /api/admin/school-year/activate` (JSON `{ "schoolYearId": "…" }`)  
   Archive l'année active précédente et active la nouvelle.

4. **Calendrier runtime** — `GET /api/school-year/calendar`  
   Utilisé par l'application (enseignant / élève).

## Critères de validation

- Titre « Année scolaire YYYY-YYYY » détecté
- 11 mois (Août … Juin) présents
- **38 semaines** avec lundi de référence cohérent (A/B alterné)
- Test automatisé : `tests/fixtures/SemainesA-B26-27.pdf`

## Hors scope (phase ultérieure)

- Jours fériés / vacances (affichage)
- Rôle administrateur distinct (prévu phase 2.4)
