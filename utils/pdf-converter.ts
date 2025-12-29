"use client";

export interface ImageToPdfOptions {
  images: File[];
  pageSize?: "a4" | "letter" | "legal" | "auto";
  orientation?: "portrait" | "landscape";
  margin?: number;
  quality?: number;
}

/**
 * Convert multiple images to a single PDF file
 * @param options - Configuration options for PDF conversion
 * @returns Promise that resolves to the PDF Blob
 */
export async function imagesToPdf(
  options: ImageToPdfOptions
): Promise<Blob> {
  const {
    images,
    pageSize = "a4",
    orientation = "portrait",
    margin = 10,
    quality = 0.92,
  } = options;

  // Dynamically import jsPDF
  const { jsPDF } = await import("jspdf");

  // Create new PDF document
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: pageSize === "auto" ? "a4" : pageSize,
  });

  // Process each image
  for (let i = 0; i < images.length; i++) {
    const image = images[i];

    // Read image as data URL
    const imageData = await readFileAsDataURL(image);

    // Create an image element to get dimensions
    const img = await loadImage(imageData);

    // Calculate dimensions based on page size
    const pageWidth =
      pageSize === "a4"
        ? orientation === "portrait"
          ? 210
          : 297
        : orientation === "portrait"
        ? 215.9
        : 279.4;
    const pageHeight =
      pageSize === "a4"
        ? orientation === "portrait"
          ? 297
          : 210
        : orientation === "portrait"
        ? 279.4
        : 215.9;

    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;

    // Calculate scaled dimensions
    const ratio = Math.min(
      maxWidth / img.width,
      maxHeight / img.height
    );
    const imgWidth = img.width * ratio;
    const imgHeight = img.height * ratio;

    // Center image on page
    const x = (pageWidth - imgWidth) / 2;
    const y = (pageHeight - imgHeight) / 2;

    // Add new page for subsequent images
    if (i > 0) {
      pdf.addPage();
    }

    // Add image to PDF
    pdf.addImage(
      imageData,
      "JPEG",
      x,
      y,
      imgWidth,
      imgHeight,
      undefined,
      "FAST"
    );
  }

  // Return PDF as blob
  return pdf.output("blob");
}

/**
 * Convert PDF to images (one image per page)
 * @param pdfFile - The PDF file to convert
 * @param format - Output image format
 * @param scale - Scale factor for rendering (higher = better quality)
 * @returns Promise that resolves to an array of image Blobs
 */
export async function pdfToImages(
  pdfFile: File,
  format: "png" | "jpeg" = "png",
  scale = 2
): Promise<Blob[]> {
  try {
    // Dynamically import PDF.js
    const pdfjsLib = await import("pdfjs-dist");

    // Configure PDF.js worker - use a more reliable CDN
    if (typeof window !== "undefined") {
      const pdfjsVersion = pdfjsLib.version || "4.0.379";
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await pdfFile.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const images: Blob[] = [];

  // Process each page
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not get canvas context");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render page to canvas
    await page.render({
      canvasContext: context,
      viewport,
    } as any).promise;

    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create blob"));
        },
        `image/${format}`,
        0.95
      );
    });

    images.push(blob);
  }

  return images;
  } catch (error) {
    console.error("PDF to images conversion error:", error);
    throw new Error(`Failed to convert PDF to images: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to read file as data URL
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper function to load image
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
