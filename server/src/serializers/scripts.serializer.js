import { createPresignedGetUrl } from "../s3.js";

export async function withScriptViewUrl(row) {
    if (!row) return row;
    if (!row.s3_key) return { ...row, script_url: null };

    try {
        const { url } = await createPresignedGetUrl({ key: row.s3_key });
        return { ...row, script_url: url };
    } catch (err) {
        console.error("Failed to sign script URL:", row.s3_key, err?.message);
        return { ...row, script_url: null };
    }
}
