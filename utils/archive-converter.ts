"use client";

// Archive conversion utilities for browser-side processing

/**
 * Create a ZIP file from multiple files
 */
export async function createZip(
  files: { name: string; blob: Blob }[]
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Add each file to the ZIP
  files.forEach(({ name, blob }) => {
    zip.file(name, blob);
  });

  // Generate and return the ZIP file
  return await zip.generateAsync({ type: "blob" });
}

/**
 * Extract files from a ZIP archive
 */
export async function extractZip(
  zipFile: File
): Promise<{ name: string; blob: Blob }[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipFile);

  const files: { name: string; blob: Blob }[] = [];

  // Extract each file
  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (!zipEntry.dir) {
      // Skip directories
      const blob = await zipEntry.async("blob");
      files.push({
        name: filename,
        blob,
      });
    }
  }

  return files;
}

/**
 * Download multiple converted files as a ZIP
 */
export async function downloadFilesAsZip(
  files: { name: string; blob: Blob }[],
  zipName: string = "converted-files.zip"
): Promise<void> {
  const zipBlob = await createZip(files);

  // Create download link
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
