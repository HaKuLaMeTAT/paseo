import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";

/** Keep clipboard bytes in Chromium storage instead of writing and rereading an image file. */
export function createDesktopInlineAttachmentStore(
  files: AttachmentStore,
  inline: AttachmentStore,
): AttachmentStore {
  const owner = (attachment: AttachmentMetadata) =>
    attachment.storageType === "web-indexeddb" ? inline : files;
  return {
    storageType: inline.storageType,
    save: (input) => (input.source.kind === "file_uri" ? files.save(input) : inline.save(input)),
    async encodeBase64(input) {
      const data = await owner(input.attachment).encodeBase64(input);
      if (input.attachment.mimeType.startsWith("image/")) {
        try {
          const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(
            new Blob([bytes], { type: input.attachment.mimeType }),
          );
          bitmap.close();
        } catch {
          throw new Error(
            "图片无法解码，请删除此附件后重新截图粘贴。Image could not be decoded; paste a fresh screenshot.",
          );
        }
      }
      return data;
    },
    resolvePreviewUrl: (input) => owner(input.attachment).resolvePreviewUrl(input),
    async releasePreviewUrl(input) {
      await owner(input.attachment).releasePreviewUrl?.(input);
    },
    delete: (input) => owner(input.attachment).delete(input),
    async garbageCollect(input) {
      await Promise.all([files.garbageCollect(input), inline.garbageCollect(input)]);
    },
  };
}
