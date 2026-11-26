import type { PartialDictionary } from "@/lib/i18n/types";

const dict: PartialDictionary = {
  en: {
    "settingsView.title": "Settings",
    "settingsView.pageGeneral": "General",
    "settingsView.pageDevices": "Devices",
    "settingsView.pageReading": "Reading",
    "settingsView.pageExtensions": "Extensions",
    "settingsView.pageAbout": "About Leaf",
    "settingsView.savedAutomatically": "Saved automatically",
    "settingsView.saving": "Saving…",
    "settingsView.loading": "Loading…",

    "settingsView.appearance": "Appearance",
    "settingsView.whatsNew": "What's new",
    "settingsView.language": "Language",
    "settingsView.languageDetail": "The app's own text. A series keeps the language it was published in.",
    "settingsView.languageSystem": "Same as the system",
    "settingsView.theme": "Theme",
    "settingsView.themeDetail": "Paper in light, ink-green in dark.",
    "settingsView.themeSystem": "System",
    "settingsView.themeLight": "Light",
    "settingsView.themeDark": "Dark",

    "settingsView.folders": "Folders",
    "settingsView.libraryFolder": "Shelf",
    "settingsView.libraryFolderDetail":
      "Where chapters and covers live. Changing it does not move files already there.",
    "settingsView.buildFolder": "Built volumes",
    "settingsView.buildFolderDetail":
      "Where Build writes without asking. Build as… still picks a one-off place.",
    "settingsView.buildFolderUnset": "Not set — Build asks every time",
    "settingsView.change": "Change…",
    "settingsView.clear": "Clear",
    "settingsView.reveal": "Show in file manager",
    "settingsView.folderPerSeries": "A folder per series",
    "settingsView.folderPerSeriesOn": "Ichi the Witch/Ichi the Witch v01.epub",
    "settingsView.folderPerSeriesOff": "Ichi the Witch v01.epub — everything in one folder",

    "settingsView.generated": "Generated files",
    "settingsView.format": "Default format",
    "settingsView.formatDetail":
      "Already chosen when you assemble a volume, and what batch builds use.",
    "settingsView.formatEpub": "EPUB · Kindle",
    "settingsView.formatCbz": "CBZ · Comic readers",
    "settingsView.pageSize": "Default page size",
    "settingsView.splitSpreads": "Split double pages",
    "settingsView.splitSpreadsOn":
      "Each spread becomes two pages, right half first for manga. Almost always what you want on a Kindle.",
    "settingsView.splitSpreadsOff":
      "Spreads stay whole, shown smaller with white bars — pinch to zoom.",
    "settingsView.coverBadge": "Volume number on the cover",
    "settingsView.coverBadgeOn":
      "A ribbon with the number on the library cover, so a long series can be told apart. EPUB only.",
    "settingsView.coverBadgeOff": "The cover is shown exactly as published.",
    "settingsView.customEdge": "Longest edge",
    "settingsView.customQuality": "JPEG quality",
    "settingsView.customNoLimit": "No limit",
    "settingsView.customHint":
      "Leave the edge empty to keep pages at their size. Pages are only ever shrunk, between {min} and {max}px. Quality runs from {qmin} to 100; much below 70 smears screentones.",
    "settingsView.grayscale": "Pages in greyscale",
    "settingsView.grayscaleDetail":
      "Colour covers stay in colour. Saves about a third again on e-ink.",

    "settingsView.updates": "Updates",
    "settingsView.version": "Leaf {version}",
    "settingsView.upToDate": "You are on the latest version.",
    "settingsView.updateAvailable": "A new version is ready to install.",
    "settingsView.updateUnknown": "Looks for a new version when it starts.",
    "settingsView.checkNow": "Check now",
    "settingsView.androidUpdates":
      "There is no store to update a sideloaded build: Leaf fetches the release and Android asks before installing it.",

    "settingsView.readingDefaults": "Reader defaults",
    "settingsView.readingDefaultsDetail":
      "Also changed while reading, from the reader's settings button.",
    "settingsView.readerMode": "Layout",
    "settingsView.readerFit": "Fit",
    "settingsView.readerBackground": "Background",
    "settingsView.readerAnimation": "Page turn",
    "settingsView.bgBlack": "Black",
    "settingsView.bgGrey": "Grey",
    "settingsView.bgWhite": "White",
    "settingsView.animSlide": "Slide",
    "settingsView.animFade": "Fade",
    "settingsView.animNone": "None",

    "settingsView.aboutBody":
      "Leaf turns manga chapters into volumes for an e-reader, and reads them along the way. Extensions are third-party: Leaf hosts no chapters.",
  },
  "pt-BR": {
    "settingsView.title": "Configurações",
    "settingsView.pageGeneral": "Geral",
    "settingsView.pageDevices": "Dispositivos",
    "settingsView.pageReading": "Leitura",
    "settingsView.pageExtensions": "Extensões",
    "settingsView.pageAbout": "Sobre o Leaf",
    "settingsView.savedAutomatically": "Salvo automaticamente",
    "settingsView.saving": "Salvando…",
    "settingsView.loading": "Carregando…",

    "settingsView.appearance": "Aparência",
    "settingsView.whatsNew": "Novidades",
    "settingsView.language": "Idioma",
    "settingsView.languageDetail": "Os textos do próprio app. Uma série mantém o idioma em que foi publicada.",
    "settingsView.languageSystem": "Igual ao sistema",
    "settingsView.theme": "Tema",
    "settingsView.themeDetail": "Papel no claro, verde-nanquim no escuro.",
    "settingsView.themeSystem": "Sistema",
    "settingsView.themeLight": "Claro",
    "settingsView.themeDark": "Escuro",

    "settingsView.folders": "Pastas",
    "settingsView.libraryFolder": "Estante",
    "settingsView.libraryFolderDetail":
      "Onde ficam capítulos e capas. Mudar não move os arquivos que já existem.",
    "settingsView.buildFolder": "EPUBs gerados",
    "settingsView.buildFolderDetail":
      "Onde o Gerar grava sem perguntar. “Gerar como…” ainda escolhe outro lugar.",
    "settingsView.buildFolderUnset": "Não definida — pergunta toda vez",
    "settingsView.change": "Alterar…",
    "settingsView.clear": "Limpar",
    "settingsView.reveal": "Mostrar no gerenciador de arquivos",
    "settingsView.folderPerSeries": "Uma pasta por série",
    "settingsView.folderPerSeriesOn": "Ichi the Witch/Ichi the Witch v01.epub",
    "settingsView.folderPerSeriesOff": "Ichi the Witch v01.epub — tudo numa pasta só",

    "settingsView.generated": "Arquivos gerados",
    "settingsView.format": "Formato padrão",
    "settingsView.formatDetail":
      "Já vem selecionado ao montar um volume, e é o que a geração em lote usa.",
    "settingsView.formatEpub": "EPUB · Kindle",
    "settingsView.formatCbz": "CBZ · Leitores de quadrinhos",
    "settingsView.pageSize": "Tamanho padrão da página",
    "settingsView.splitSpreads": "Dividir páginas duplas",
    "settingsView.splitSpreadsOn":
      "Cada dupla vira duas páginas, lado direito primeiro. Quase sempre é o que você quer.",
    "settingsView.splitSpreadsOff":
      "Duplas ficam inteiras, menores e com faixas brancas — pinça para ampliar.",
    "settingsView.coverBadge": "Número do volume na capa",
    "settingsView.coverBadgeOn":
      "Uma fita com o número na capa da biblioteca do Kindle. Só EPUB.",
    "settingsView.coverBadgeOff": "A capa aparece exatamente como publicada.",
    "settingsView.customEdge": "Lado maior",
    "settingsView.customQuality": "Qualidade JPEG",
    "settingsView.customNoLimit": "Sem limite",
    "settingsView.customHint":
      "Deixe o lado vazio para manter o tamanho das páginas. Páginas só diminuem, entre {min} e {max}px. A qualidade vai de {qmin} a 100; bem abaixo de 70 borra retículas.",
    "settingsView.grayscale": "Páginas em tons de cinza",
    "settingsView.grayscaleDetail":
      "Capas coloridas continuam coloridas. Economiza mais um terço do tamanho.",

    "settingsView.updates": "Atualizações",
    "settingsView.version": "Leaf {version}",
    "settingsView.upToDate": "Você está na versão mais recente.",
    "settingsView.updateAvailable": "Uma nova versão está pronta para instalar.",
    "settingsView.updateUnknown": "Procura uma versão nova ao abrir.",
    "settingsView.checkNow": "Procurar agora",
    "settingsView.androidUpdates":
      "Não há loja para atualizar uma instalação manual: o Leaf baixa a versão e o Android pergunta antes de instalar.",

    "settingsView.readingDefaults": "Padrões do leitor",
    "settingsView.readingDefaultsDetail":
      "Também mudam durante a leitura, no botão de ajustes do leitor.",
    "settingsView.readerMode": "Layout",
    "settingsView.readerFit": "Ajuste",
    "settingsView.readerBackground": "Fundo",
    "settingsView.readerAnimation": "Virada de página",
    "settingsView.bgBlack": "Preto",
    "settingsView.bgGrey": "Cinza",
    "settingsView.bgWhite": "Branco",
    "settingsView.animSlide": "Deslizar",
    "settingsView.animFade": "Esmaecer",
    "settingsView.animNone": "Nenhuma",

    "settingsView.aboutBody":
      "O Leaf transforma capítulos de mangá em volumes para e-readers, e lê pelo caminho. Extensões são de terceiros: o Leaf não hospeda capítulos.",
  },
};

export default dict;
