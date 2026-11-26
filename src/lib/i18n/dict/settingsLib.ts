import type { PartialDictionary } from "@/lib/i18n/types";

/** `lib/settings.ts`'s `compressionPresets` — separate from `SettingsView`'s
 * own dict since it lives outside any component. */
const dict: PartialDictionary = {
  en: {
    "settings.deviceKind.kindle": "Kindle",
    "settings.deviceKind.kobo": "Kobo",
    "settings.deviceKind.boox": "Boox",
    "settings.deviceKind.other": "Other reader",
    "settings.deliveryEmailShort": "email",
    "settings.deliveryFolderShort": "folder",
    "settings.deliveryUsbShort": "USB",
    "settings.resolutionOriginal": "original size",
    "settings.compressionOriginal": "Original",
    "settings.compressionOriginalDetail":
      "Pages are copied untouched. Largest files, and usually far more detail than any e-reader can show.",
    "settings.compressionLarge": "Large · 2400px",
    "settings.compressionLargeDetail":
      "For a Kindle Scribe or a tablet. Roughly half the size of the original.",
    "settings.compressionKindle": "Kindle · 1600px",
    "settings.compressionKindleDetail":
      "Matches a Paperwhite or Oasis exactly. Typically a quarter of the original size, with nothing visible lost on the device.",
    "settings.compressionCompact": "Compact · 1280px",
    "settings.compressionCompactDetail":
      "When a volume has to fit an email attachment limit. Softer if you zoom right in.",
    "settings.compressionCustom": "Custom",
    "settings.compressionCustomDetail":
      "Your own size and quality — for a device none of the presets fit, or to trade file size against sharpness yourself.",
  },
  "pt-BR": {
    "settings.deviceKind.kindle": "Kindle",
    "settings.deviceKind.kobo": "Kobo",
    "settings.deviceKind.boox": "Boox",
    "settings.deviceKind.other": "Outro leitor",
    "settings.deliveryEmailShort": "e-mail",
    "settings.deliveryFolderShort": "pasta",
    "settings.deliveryUsbShort": "USB",
    "settings.resolutionOriginal": "tamanho original",
    "settings.compressionOriginal": "Original",
    "settings.compressionOriginalDetail":
      "As páginas são copiadas sem alteração. Arquivos maiores, e geralmente com mais detalhe do que qualquer e-reader consegue mostrar.",
    "settings.compressionLarge": "Grande · 2400px",
    "settings.compressionLargeDetail":
      "Para um Kindle Scribe ou um tablet. Cerca de metade do tamanho original.",
    "settings.compressionKindle": "Kindle · 1600px",
    "settings.compressionKindleDetail":
      "Corresponde exatamente a um Paperwhite ou Oasis. Normalmente um quarto do tamanho original, sem perda visível no aparelho.",
    "settings.compressionCompact": "Compacto · 1280px",
    "settings.compressionCompactDetail":
      "Quando um volume precisa caber no limite de anexo de um e-mail. Fica mais suave se você der bastante zoom.",
    "settings.compressionCustom": "Personalizado",
    "settings.compressionCustomDetail":
      "Seu próprio tamanho e qualidade — para um aparelho que nenhuma predefinição atende, ou para equilibrar tamanho de arquivo e nitidez você mesmo.",
  },
};

export default dict;
