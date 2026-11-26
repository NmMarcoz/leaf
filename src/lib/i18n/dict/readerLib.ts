import type { PartialDictionary } from "@/lib/i18n/types";

/** `lib/reader.ts`'s `readerModes`/`readerFits` — outside any component, so
 * kept separate from `ReaderSettings`'s own dict. */
const dict: PartialDictionary = {
  en: {
    "reader.modePaged": "One at a time",
    "reader.modePagedDetail": "How most manga is drawn",
    "reader.modeDouble": "Two side by side",
    "reader.modeDoubleDetail": "Like an open book",
    "reader.modeWebtoon": "Continuous scroll",
    "reader.modeWebtoonDetail": "For webtoons",
    "reader.fitContain": "Whole page",
    "reader.fitWidth": "Width",
    "reader.fitHeight": "Height",
    "reader.fitOriginal": "Original",
  },
  "pt-BR": {
    "reader.modePaged": "Uma por vez",
    "reader.modePagedDetail": "Como a maioria dos mangás é desenhada",
    "reader.modeDouble": "Duas lado a lado",
    "reader.modeDoubleDetail": "Como um livro aberto",
    "reader.modeWebtoon": "Rolagem contínua",
    "reader.modeWebtoonDetail": "Para webtoons",
    "reader.fitContain": "Página inteira",
    "reader.fitWidth": "Largura",
    "reader.fitHeight": "Altura",
    "reader.fitOriginal": "Original",
  },
};

export default dict;
