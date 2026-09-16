import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopAttachmentStore } from "./desktop-attachment-store";
import { createFakeDesktopAttachmentBridge } from "./test-utils/fake-desktop-attachment-bridge";

describe("desktop attachment store", () => {
  it("saves dropped file paths as desktop-file metadata", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    const store = createDesktopAttachmentStore(fake.bridge);

    const attachment = await store.save({
      id: "att_1",
      mimeType: "image/png",
      source: {
        kind: "file_uri",
        uri: "file:///Users/test/Desktop/image.png",
      },
    });

    expect(fake.savedEntries).toEqual([
      {
        attachmentId: "att_1",
        path: "/managed/att_1.png",
        byteSize: 4,
        extension: ".png",
        source: { kind: "copy", sourcePath: "/Users/test/Desktop/image.png" },
      },
    ]);
    expect(attachment).toMatchObject({
      storageType: "desktop-file",
      storageKey: "/managed/att_1.png",
    });
  });

  it("saves blob/data-url sources via desktop filesystem writes", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    const store = createDesktopAttachmentStore(fake.bridge);

    await store.save({
      id: "att_2",
      source: {
        kind: "data_url",
        dataUrl: "data:image/png;base64,AAECAw==",
      },
    });

    expect(fake.savedEntries).toEqual([
      {
        attachmentId: "att_2",
        path: "/managed/att_2.png",
        byteSize: 4,
        extension: ".png",
        source: { kind: "base64", base64: "AAECAw==" },
      },
    ]);
  });

  it("saves raw byte sources via desktop filesystem writes", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    const store = createDesktopAttachmentStore(fake.bridge);
    const bytes = new Uint8Array([0, 1, 2, 3]);

    const attachment = await store.save({
      id: "att_bytes",
      mimeType: "image/png",
      fileName: "inline.png",
      source: {
        kind: "bytes",
        bytes,
      },
    });

    expect(fake.savedEntries).toEqual([
      {
        attachmentId: "att_bytes",
        path: "/managed/att_bytes.png",
        byteSize: 4,
        extension: ".png",
        source: { kind: "bytes", bytes },
      },
    ]);
    expect(attachment).toMatchObject({
      id: "att_bytes",
      mimeType: "image/png",
      storageType: "desktop-file",
      storageKey: "/managed/att_bytes.png",
      fileName: "inline.png",
      byteSize: 4,
    });
  });

  it("delegates encode/preview/delete/gc to desktop command path", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    const store = createDesktopAttachmentStore(fake.bridge);
    const attachment = {
      id: "att_3",
      mimeType: "image/jpeg",
      storageType: "desktop-file" as const,
      storageKey: "/managed/att_3.jpg",
      createdAt: Date.now(),
    };

    await store.encodeBase64({ attachment });
    await store.resolvePreviewUrl({ attachment });
    await store.releasePreviewUrl?.({ attachment, url: "blob:test" });
    await store.delete({ attachment });
    await store.garbageCollect({ referencedIds: new Set(["att_3"]) });

    expect(fake.readBase64Calls).toEqual(["/managed/att_3.jpg"]);
    expect(fake.resolvedPreviewUrls).toEqual([attachment]);
    expect(fake.releasedPreviewUrls).toEqual(["blob:test"]);
    expect(fake.deletedPaths).toEqual(["/managed/att_3.jpg"]);
    expect(fake.garbageCollections).toEqual([{ referencedIds: ["att_3"] }]);
  });
});

import { createDesktopInlineAttachmentStore } from "./desktop-inline-attachment-store";
import type { AttachmentStore, AttachmentMetadata } from "@/attachments/types";

afterEach(() => vi.unstubAllGlobals());

describe("desktop clipboard attachment storage", () => {
  it("keeps pasted bytes out of the file bridge and routes previews, reloads and GC by metadata", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    const files = createDesktopAttachmentStore(fake.bridge);
    const metadata: AttachmentMetadata = {
      id: "clip",
      storageType: "web-indexeddb",
      storageKey: "clip",
      mimeType: "image/png",
      createdAt: 1,
    };
    const inline: AttachmentStore = {
      storageType: "web-indexeddb",
      save: vi.fn(async () => metadata),
      encodeBase64: vi.fn(async () => "AAECAw=="),
      resolvePreviewUrl: vi.fn(async () => "blob:clipboard"),
      releasePreviewUrl: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      garbageCollect: vi.fn(async () => {}),
    };
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close })),
    );
    const store = createDesktopInlineAttachmentStore(files, inline);
    const source = {
      kind: "blob" as const,
      blob: new Blob([new Uint8Array([0, 1, 2, 3])], { type: "image/png" }),
    };
    const saved = await store.save({ source });
    expect(inline.save).toHaveBeenCalledWith({ source });
    expect(fake.savedEntries).toEqual([]);
    const reloaded = createDesktopInlineAttachmentStore(files, inline);
    await expect(reloaded.encodeBase64({ attachment: saved })).resolves.toBe("AAECAw==");
    expect(close).toHaveBeenCalledOnce();
    await expect(reloaded.resolvePreviewUrl({ attachment: saved })).resolves.toBe("blob:clipboard");
    await reloaded.releasePreviewUrl?.({ attachment: saved, url: "blob:clipboard" });
    expect(inline.releasePreviewUrl).toHaveBeenCalledOnce();
    await reloaded.delete({ attachment: saved });
    expect(inline.delete).toHaveBeenCalledOnce();
    await reloaded.garbageCollect({ referencedIds: new Set([saved.id]) });
    expect(inline.garbageCollect).toHaveBeenCalledOnce();
    expect(fake.garbageCollections).toEqual([{ referencedIds: ["clip"] }]);
    const old = await reloaded.save({
      source: { kind: "file_uri", uri: "file:///old.png" },
      mimeType: "image/png",
    });
    expect(old.storageType).toBe("desktop-file");
    await reloaded.encodeBase64({ attachment: old });
    expect(fake.readBase64Calls).toEqual([old.storageKey]);
  });

  it("rejects image bytes that the image decoder cannot read", async () => {
    const fake = createFakeDesktopAttachmentBridge();
    fake.bridge.readFileBase64 = async () => btoa("%TSD-Header-###%");
    const files = createDesktopAttachmentStore(fake.bridge);
    const store = createDesktopInlineAttachmentStore(files, files);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("Invalid image");
      }),
    );
    await expect(
      store.encodeBase64({
        attachment: {
          id: "bad",
          storageType: "desktop-file",
          storageKey: "/bad.png",
          mimeType: "image/png",
          createdAt: 1,
        },
      }),
    ).rejects.toThrow("重新截图粘贴");
  });
});
