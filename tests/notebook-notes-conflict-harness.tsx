import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ClassNotebookPanel } from "../web/app/components/class-notebook-panel.tsx";
import {
  createEmptyNotesDocument,
  fromPlainText,
  setSessionRichNote,
} from "../src/features/class-notebook/index.ts";

const head = "DEBUT-COMPOSANT";
const tail = "FIN-COMPOSANT";
const initial = setSessionRichNote(
  createEmptyNotesDocument(),
  "session-16",
  fromPlainText(`${head} ${"a".repeat(500)} ${tail}`),
);

function Harness() {
  const [notes, setNotes] = useState(initial);
  const [tick, setTick] = useState(0);
  const [replaced, setReplaced] = useState("");
  return (
    <div>
      <ClassNotebookPanel
        classSetup={{
          id: "class-meca",
          name: "Mécanique",
          programLabel: "CFC",
          dayOfWeek: 1,
          branchNames: ["Mécanique"],
          icon: "meca",
          professionPrefix: "MECA",
        }}
        branchLabel="Mécanique"
        schoolWeeks={[]}
        centerWeekNumber={1}
        items={[]}
        notesDocument={notes}
        canPublish={false}
        notesSyncInterrupted
        onBack={() => {}}
        onShiftWeeks={() => {}}
        onCenterWeekChange={() => {}}
        onNotesChange={setNotes}
        onCreatePublication={async () => {}}
        onSaveWeekPublication={async () => {}}
        onSetWeekPublicationVisibility={async () => {}}
        onMovePublication={async () => {}}
        onSaveControl={async () => {}}
        onUpdateControl={async () => {}}
        onDeleteControl={async () => {}}
        onReloadServerNotes={(fingerprint) => setReplaced(fingerprint)}
      />
      <button
        type="button"
        id="change-note"
        onClick={() => {
          const next = tick + 1;
          setTick(next);
          setNotes(setSessionRichNote(createEmptyNotesDocument(), "session-16", fromPlainText(`Note changée ${next}`)));
        }}
      >
        Changer la note
      </button>
      <p data-replaced={replaced ? "yes" : "no"}>{replaced ? "remplace" : ""}</p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Harness />);
