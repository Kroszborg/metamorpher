"use client";

// Document conversion utilities for browser-side processing

export interface DocumentConversionOptions {
  pageSize?: "a4" | "letter" | "legal";
  orientation?: "portrait" | "landscape";
  fontSize?: number;
  margin?: number;
}

/**
 * Convert Markdown to HTML
 */
export async function markdownToHtml(markdownFile: File): Promise<string> {
  const MarkdownIt = (await import("markdown-it")).default;
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  const text = await markdownFile.text();
  return md.render(text);
}

/**
 * Convert Markdown to PDF
 */
export async function markdownToPdf(
  markdownFile: File,
  options: DocumentConversionOptions = {}
): Promise<Blob> {
  const html = await markdownToHtml(markdownFile);
  return await htmlToPdf(html, options);
}

/**
 * Convert HTML content to PDF
 */
export async function htmlToPdf(
  htmlContent: string,
  options: DocumentConversionOptions = {}
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const DOMPurify = (await import("dompurify")).default;

  const {
    pageSize = "a4",
    orientation = "portrait",
    fontSize = 12,
    margin = 20,
  } = options;

  // Sanitize HTML
  const clean = DOMPurify.sanitize(htmlContent);

  // Create PDF
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: pageSize,
  });

  // Get page dimensions
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;

  // Create a temporary div to parse HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = clean;
  tempDiv.style.width = `${maxWidth}mm`;
  tempDiv.style.fontSize = `${fontSize}px`;
  tempDiv.style.lineHeight = "1.6";
  tempDiv.style.position = "absolute";
  tempDiv.style.left = "-9999px";
  document.body.appendChild(tempDiv);

  let yPosition = margin;

  // Process text nodes
  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        const lines = pdf.splitTextToSize(text, maxWidth);
        lines.forEach((line: string) => {
          if (yPosition > pageHeight - margin) {
            pdf.addPage();
            yPosition = margin;
          }
          pdf.text(line, margin, yPosition);
          yPosition += fontSize * 0.5;
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();

      // Handle headings
      if (tagName.match(/^h[1-6]$/)) {
        const headingSize = fontSize * (2.5 - parseInt(tagName[1]) * 0.3);
        pdf.setFontSize(headingSize);
        pdf.setFont("helvetica", "bold");
        yPosition += headingSize * 0.3;
      }

      // Process children
      node.childNodes.forEach(processNode);

      // Reset after headings
      if (tagName.match(/^h[1-6]$/)) {
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", "normal");
        yPosition += fontSize * 0.5;
      }

      // Add spacing after paragraphs
      if (tagName === "p") {
        yPosition += fontSize * 0.3;
      }
    }
  };

  tempDiv.childNodes.forEach(processNode);
  document.body.removeChild(tempDiv);

  return pdf.output("blob");
}

/**
 * Convert HTML file to PDF
 */
export async function htmlFileToPdf(
  htmlFile: File,
  options: DocumentConversionOptions = {}
): Promise<Blob> {
  const htmlContent = await htmlFile.text();
  return await htmlToPdf(htmlContent, options);
}

/**
 * Convert plain text to PDF
 */
export async function textToPdf(
  textFile: File,
  options: DocumentConversionOptions = {}
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const {
    pageSize = "a4",
    orientation = "portrait",
    fontSize = 12,
    margin = 20,
  } = options;

  const text = await textFile.text();

  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: pageSize,
  });

  pdf.setFontSize(fontSize);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;

  let yPosition = margin;
  const lines = pdf.splitTextToSize(text, maxWidth);

  lines.forEach((line: string) => {
    if (yPosition > pageHeight - margin) {
      pdf.addPage();
      yPosition = margin;
    }
    pdf.text(line, margin, yPosition);
    yPosition += fontSize * 0.5;
  });

  return pdf.output("blob");
}

/**
 * Convert DOCX to HTML
 */
export async function docxToHtml(docxFile: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await docxFile.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

/**
 * Convert DOCX to PDF
 */
export async function docxToPdf(
  docxFile: File,
  options: DocumentConversionOptions = {}
): Promise<Blob> {
  const html = await docxToHtml(docxFile);
  return await htmlToPdf(html, options);
}

/**
 * Convert DOCX to Markdown (via HTML)
 * Note: This is a simplified conversion via HTML since mammoth doesn't support direct MD
 */
export async function docxToMarkdown(docxFile: File): Promise<string> {
  // Convert to HTML first
  const html = await docxToHtml(docxFile);

  // Simple HTML to Markdown conversion
  let markdown = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/g, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/g, '#### $1\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/g, '##### $1\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/g, '###### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
    .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
    .replace(/\n{3,}/g, '\n\n'); // Clean up excessive newlines

  return markdown.trim();
}
