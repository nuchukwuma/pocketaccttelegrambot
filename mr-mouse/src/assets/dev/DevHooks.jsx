import { useEffect } from "react";
import { useLedger } from "../booksofacc/Ledgercontext";
import { useTheme } from "../theme/ThemeContext";
import { db } from "../components/Db";

/* Development only (npm run dev): console handles for testing the
   Stage 1 foundations before their screens exist. Never in a build. */
export default function DevHooks() {
  const { saveImage, deleteImage, setPref, connectionStatus } = useLedger();
  const { theme, setTheme, resetTheme } = useTheme();
  useEffect(() => {
    window.mrmouseDev = {
      db,
      saveImage,
      deleteImage,
      setPref,
      connectionStatus,
      theme,
      setTheme,
      resetTheme,
      /** Pick a picture and save it as an image; resolves to its id. */
      pickImage(kind = "logo") {
        return new Promise((resolve, reject) => {
          const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
          input.onchange = () => saveImage(input.files[0], { kind }).then(resolve, reject);
          input.click();
        });
      },
    };
  }, [saveImage, deleteImage, setPref, connectionStatus, theme, setTheme, resetTheme]);
  return null;
}
