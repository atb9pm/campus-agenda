/**
 * Initialise une base SQLite locale **avec** le contenu de démonstration.
 * Ne pas utiliser en production : le seed démo n'est plus automatique.
 */
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";

const path = process.env.CAMPUS_SQLITE_PATH ?? ".data/campus-agenda.sqlite";
const db = createNodeSqliteDatabase(path);
await applyMigrations(db);
await seedDemoDatabase(db);
db.close();
console.log(`Base locale initialisée : ${path}`);
