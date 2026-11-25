import type { PartialDictionary } from "@/lib/i18n/types";

/** `lib/api.ts`'s `excludeLabel`, `deliverLabel` and `languageName` — outside
 * any component. `api.displayLocale` is the BCP 47 tag `Intl.DisplayNames`
 * names every other language in, so it must stay a valid locale. */
const dict: PartialDictionary = {
  en: {
    "api.excludeOffSize": "Off-size {width}×{height}",
    "api.excludeUnreadable": "Unreadable",
    "api.excludeNotAPage": "Not a page",
    "api.excludeManual": "Excluded",
    "api.deliverShow": "Show",
    "api.deliverShare": "Share",
    "api.displayLocale": "en",
    "api.languagePtBr": "Portuguese (Brazil)",
    "api.languageEsLa": "Spanish (Latin America)",
    "api.languageZhHk": "Chinese (Hong Kong)",
    "api.languageJaRo": "Japanese (romanised)",
    "api.languageKoRo": "Korean (romanised)",
    "api.languageZhRo": "Chinese (romanised)",
  },
  "pt-BR": {
    "api.excludeOffSize": "Fora do tamanho {width}×{height}",
    "api.excludeUnreadable": "Ilegível",
    "api.excludeNotAPage": "Não é uma página",
    "api.excludeManual": "Excluída",
    "api.deliverShow": "Mostrar",
    "api.deliverShare": "Compartilhar",
    "api.displayLocale": "pt-BR",
    "api.languagePtBr": "Português (Brasil)",
    "api.languageEsLa": "Espanhol (América Latina)",
    "api.languageZhHk": "Chinês (Hong Kong)",
    "api.languageJaRo": "Japonês (romanizado)",
    "api.languageKoRo": "Coreano (romanizado)",
    "api.languageZhRo": "Chinês (romanizado)",
  },
};

export default dict;
