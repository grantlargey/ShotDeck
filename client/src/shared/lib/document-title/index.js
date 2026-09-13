import { useEffect } from "react";

const APP_NAME = "ScriptDeck";

/** Sets the browser tab title to "<title> · ScriptDeck", or just the app name. */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
