import type { PartialDictionary } from "@/lib/i18n/types";

const dict: PartialDictionary = {
  en: {
    "extensionsView.title": "Extensions",
    "extensionsView.explainer":
      "Each .lua file in your library's extensions folder is a source that runs with the app's network access. Approve one only after reading it or trusting its author; develop mode skips that check while you edit a file of your own — lock it when it is done.",
    "extensionsView.empty":
      "No extension files yet. Add one here, or drop a .lua file into the extensions folder of your library.",
    "extensionsView.add": "Add extension",
    "extensionsView.update": "Update",
    "extensionsView.remove": "Remove",
    "extensionsView.approve": "Approve",
    "extensionsView.develop": "Develop",
    "extensionsView.lock": "Lock",
    "extensionsView.stopDeveloping": "Stop developing",
    "extensionsView.activate": "Activate",
    "extensionsView.deactivate": "Deactivate",
    "extensionsView.state.approved": "Approved",
    "extensionsView.state.dev": "Developing",
    "extensionsView.state.pending": "Needs approval",
    "extensionsView.state.disabled": "Off",
    "extensionsView.state.broken": "Broken",
  },
  "pt-BR": {
    "extensionsView.title": "Extensões",
    "extensionsView.explainer":
      "Cada arquivo .lua na pasta de extensões da sua biblioteca é uma fonte que roda com o acesso de rede do app. Aprove uma só depois de lê-la ou de confiar em quem a escreveu; o modo desenvolvimento pula essa verificação enquanto você edita um arquivo seu — trave-o quando terminar.",
    "extensionsView.empty":
      "Nenhum arquivo de extensão ainda. Adicione uma aqui, ou solte um arquivo .lua na pasta de extensões da sua biblioteca.",
    "extensionsView.add": "Adicionar extensão",
    "extensionsView.update": "Atualizar",
    "extensionsView.remove": "Remover",
    "extensionsView.approve": "Aprovar",
    "extensionsView.develop": "Desenvolver",
    "extensionsView.lock": "Travar",
    "extensionsView.stopDeveloping": "Parar de desenvolver",
    "extensionsView.activate": "Ativar",
    "extensionsView.deactivate": "Desativar",
    "extensionsView.state.approved": "Aprovada",
    "extensionsView.state.dev": "Em desenvolvimento",
    "extensionsView.state.pending": "Precisa de aprovação",
    "extensionsView.state.disabled": "Desligada",
    "extensionsView.state.broken": "Quebrada",
  },
};

export default dict;
