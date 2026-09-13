import { useEffect, useRef, useState } from "react";

/** Object URL for previewing a picked file. Each URL is revoked once a newer file replaces it. */
export function useFilePreviewUrl(file) {
  const [preview, setPreview] = useState({ file: null, url: "" });

  // Adjust state while rendering when the file changes, instead of in an effect.
  if (preview.file !== file) {
    setPreview({ file, url: file ? URL.createObjectURL(file) : "" });
  }

  const previousUrlRef = useRef("");
  useEffect(() => {
    const previousUrl = previousUrlRef.current;
    previousUrlRef.current = preview.url;
    if (previousUrl && previousUrl !== preview.url) URL.revokeObjectURL(previousUrl);
  }, [preview.url]);

  return preview.url;
}
