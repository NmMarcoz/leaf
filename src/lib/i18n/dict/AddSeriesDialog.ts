import type { PartialDictionary } from "@/lib/i18n/types";

const dict: PartialDictionary = {
  en: {
    "addSeriesDialog.title": "Add a series",
    "addSeriesDialog.description": "Searches MangaDex, falling back to Kitsu. Adding also pulls the published volume layout, so the library can tell you what is missing.",
    "addSeriesDialog.volumesAndChapters": "{volumes} published volumes · {chapters} chapters",
    "addSeriesDialog.notIt": "Not it?",
    "addSeriesDialog.searchExtension": "Search one extension's catalogue",
    "addSeriesDialog.cancel": "Cancel",
    "addSeriesDialog.add": "Add to shelf",
  },
  "pt-BR": {
    "addSeriesDialog.title": "Adicionar uma série",
    "addSeriesDialog.description": "Busca no MangaDex, com o Kitsu como alternativa. Adicionar também traz os volumes publicados, para a estante mostrar o que está faltando.",
    "addSeriesDialog.volumesAndChapters": "{volumes} volumes publicados · {chapters} capítulos",
    "addSeriesDialog.notIt": "Não é essa?",
    "addSeriesDialog.searchExtension": "Buscar no catálogo de uma extensão",
    "addSeriesDialog.cancel": "Cancelar",
    "addSeriesDialog.add": "Adicionar à estante",
  },
};

export default dict;
