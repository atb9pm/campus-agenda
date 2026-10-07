function foldAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function notebookExportFilename(options: {
  classCode: string;
  branchLabel: string;
  schoolYearLabel: string;
}): string {
  const klass = foldAscii(options.classCode) || "Classe";
  const branch = foldAscii(options.branchLabel) || "Cours";
  const year = foldAscii(options.schoolYearLabel.replace("–", "-").replace("—", "-")) || "Annee";
  return `CampusAgenda_${klass}_${branch}_${year}.pdf`;
}
