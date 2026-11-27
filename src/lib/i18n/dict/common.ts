import type { PartialDictionary } from "@/lib/i18n/types";

/** A handful of one-word strings reused across more than one component,
 * kept here once rather than duplicated in each file's own dict. */
const dict: PartialDictionary = {
  en: {
    "common.black": "black",
    "common.grey": "grey",
    "common.white": "white",
    "common.showNewestFirst": "Show newest chapters first",
    "common.showOldestFirst": "Show first chapters first",
  },
  "pt-BR": {
    "common.black": "preto",
    "common.grey": "cinza",
    "common.white": "branco",
    "common.showNewestFirst": "Mostrar os capítulos mais novos primeiro",
    "common.showOldestFirst": "Mostrar os primeiros capítulos primeiro",
  },
};

export default dict;
