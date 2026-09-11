# Import de l’année scolaire

Campus Agenda distingue deux documents. Ils ne sont pas interchangeables.

## PLAN DE SCOLARITÉ

**Source officielle des dates de l’année.**

Document : PDF **Plan de scolarité** — État du Valais (Service de la formation professionnelle).

Il permet d’établir, uniquement si le texte le dit clairement :

- le libellé d’année (ex. 2028–2029) ;
- la date de début des cours ;
- la date de fin des cours ;
- les vacances, jours fériés et interruptions **explicitement** indiqués.

Il **ne définit pas** l’alternance pédagogique A/B.

Un PDF est recevable seulement si l’année, le début et la fin sont déterminés sans ambiguïté. Aucune date n’est inventée. Les événements ambigus apparaissent comme avertissement, avec le texte détecté.

Fixture de validation : `tests/fixtures/Plan-scolarite-2028-2029.pdf`.

## PLAN A/B

**Complément pédagogique éventuel, indépendant.**

Ancien document « Semaines A/B » (`tests/fixtures/SemainesA-B26-27.pdf`).

Il peut porter des numéros de semaines pédagogiques et une alternance A/B. Il n’est **plus** la source principale de création d’une année scolaire. Une année DRAFT peut exister avec début, fin et calendrier officiel, **sans** plan A/B.

Ne jamais :

- déduire A/B du plan de scolarité ;
- alterner automatiquement A/B ;
- recopier le plan A/B d’une autre année ;
- fabriquer 38 semaines A/B à partir du total « 38 semaines de cours » du document officiel.

## Interface

**Administration → Année scolaire**

- **Année active** : année opérationnelle enseignants / élèves. Inchangée par l’import d’une année future.
- **Année de travail** : préférence administrateur (stockée localement). Sert uniquement à travailler dans l’administration. **Ne modifie jamais** `SchoolYear.status`.
- **Plan de scolarité** : import du PDF officiel → aperçu par mois → **Créer l’année en brouillon**.
- Une année DRAFT porte le badge **Préparation**.
- Le bouton **Activer cette année** n’est pas proposé dans ce flux (basculement = PR séparée).

## Workflow API

1. **Analyser** — `POST /api/admin/school-year/parse` (multipart, champ `file`)  
   Détecte d’abord un plan de scolarité officiel, sinon un plan A/B historique.  
   Retourne `sourceKind: "official-plan" | "week-plan"` et un aperçu.

2. **Importer** — `POST /api/admin/school-year/import`  
   Pour un plan officiel : crée une année **DRAFT** avec `startsOn` / `endsOn` du document et les événements dans `school_day_exceptions`. **Aucune** ligne `school_weeks`.  
   Si l’année existe déjà : `"L’année scolaire 2028–2029 existe déjà."`  
   Si elle est déjà DRAFT : `replaceDraft=true` met à jour son calendrier, sans duplication ni changement de statut.

3. **Activer** — `POST /api/admin/school-year/activate`  
   Conservé pour l’existant. **Non utilisé** pour créer ou basculer une année future dans ce flux.

4. **Calendrier runtime** — `GET /api/school-year/calendar`  
   Année **ACTIVE** uniquement (enseignants / élèves).

5. **Calendrier officiel admin** — `GET /api/admin/school-year/:id/official-calendar`  
   Événements officiels de l’année de travail, y compris DRAFT.

## Persistance

Les événements officiels réutilisent `school_day_exceptions` (`day_state = holiday`, libellé du document). Pas de nouvelle table. Compatible backup v4.

## Hors scope (PR suivantes)

- Activation / archivage / basculement d’année
- Copie des classes, cours, horaires, publications
- Ajout ultérieur d’un plan A/B sur une année déjà créée
