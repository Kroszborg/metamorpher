"use client";

// imports
import { Action } from '@/types';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { pdfToImages } from './pdf-converter';
import {
  markdownToPdf,
  markdownToHtml,
  htmlFileToPdf,
  textToPdf,
  docxToHtml,
  docxToPdf,
  docxToMarkdown,
} from './document-converter';

function getFileExtension(file_name: string) {
  const regex = /(?:\.([^.]+))?$/; // Matches the last dot and everything after it
  const match = regex.exec(file_name);
  if (match && match[1]) {
    return match[1];
  }
  return ''; // No file extension found
}

function removeFileExtension(file_name: string) {
  const lastDotIndex = file_name.lastIndexOf('.');
  if (lastDotIndex !== -1) {
    return file_name.slice(0, lastDotIndex);
  }
  return file_name; // No file extension found
}

export default async function convert(
  ffmpeg: FFmpeg,
  action: Action,
): Promise<any> {
  const { file, to, file_name, file_type } = action;
  const input = getFileExtension(file_name);
  const output = removeFileExtension(file_name) + '.' + to;

  // Handle PDF to image conversion separately
  if (input === 'pdf' && (to === 'png' || to === 'jpg' || to === 'jpeg')) {
    try {
      const images = await pdfToImages(file, to === 'jpg' || to === 'jpeg' ? 'jpeg' : 'png', 2);

      // If only one page, return it directly
      if (images.length === 1) {
        const url = URL.createObjectURL(images[0]);
        return { url, output };
      }

      // Multiple pages - create a ZIP file
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add each page to ZIP
      images.forEach((blob, index) => {
        const pageNum = String(index + 1).padStart(3, '0');
        const filename = `page_${pageNum}.${to === 'jpg' || to === 'jpeg' ? 'jpg' : 'png'}`;
        zip.file(filename, blob);
      });

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);

      // Change output to .zip
      const zipOutput = removeFileExtension(file_name) + '_pages.zip';

      return { url, output: zipOutput };
    } catch (error) {
      console.error('PDF conversion error:', error);
      throw new Error('Failed to convert PDF to image');
    }
  }

  // Handle document conversions
  // Markdown conversions
  if ((input === 'md' || input === 'markdown') && to === 'pdf') {
    try {
      const blob = await markdownToPdf(file);
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('Markdown to PDF error:', error);
      throw new Error('Failed to convert Markdown to PDF');
    }
  }

  if ((input === 'md' || input === 'markdown') && to === 'html') {
    try {
      const htmlContent = await markdownToHtml(file);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('Markdown to HTML error:', error);
      throw new Error('Failed to convert Markdown to HTML');
    }
  }

  // HTML to PDF conversion
  if ((input === 'html' || input === 'htm') && to === 'pdf') {
    try {
      const blob = await htmlFileToPdf(file);
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('HTML to PDF error:', error);
      throw new Error('Failed to convert HTML to PDF');
    }
  }

  // Text to PDF conversion
  if (input === 'txt' && to === 'pdf') {
    try {
      const blob = await textToPdf(file);
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('Text to PDF error:', error);
      throw new Error('Failed to convert Text to PDF');
    }
  }

  // DOCX conversions
  if (input === 'docx' && to === 'pdf') {
    try {
      const blob = await docxToPdf(file);
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('DOCX to PDF error:', error);
      throw new Error('Failed to convert DOCX to PDF');
    }
  }

  if (input === 'docx' && to === 'html') {
    try {
      const htmlContent = await docxToHtml(file);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('DOCX to HTML error:', error);
      throw new Error('Failed to convert DOCX to HTML');
    }
  }

  if (input === 'docx' && to === 'md') {
    try {
      const mdContent = await docxToMarkdown(file);
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      return { url, output };
    } catch (error) {
      console.error('DOCX to Markdown error:', error);
      throw new Error('Failed to convert DOCX to Markdown');
    }
  }

  ffmpeg.writeFile(input, await fetchFile(file));

  // FFMEG COMMANDS
  let ffmpeg_cmd: any = [];

  // Video to Image (thumbnail extraction)
  const videoFormats = ['mp4', 'm4v', 'mp4v', '3gp', '3g2', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'ogv', 'webm', 'h264', '264', 'hevc', '265', 'gif'];
  const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico', 'tif', 'tiff', 'svg', 'raw', 'tga'];

  if (to && videoFormats.includes(input) && imageFormats.includes(to)) {
    // Extract frame at 1 second with high quality
    ffmpeg_cmd = [
      '-ss', '00:00:01',  // Seek to 1 second
      '-i', input,
      '-vframes', '1',     // Extract 1 frame
      '-q:v', '2',         // High quality (2-5 range, 2 is high)
      output,
    ];
  }
  // 3gp video
  else if (to === '3gp')
    ffmpeg_cmd = [
      '-i',
      input,
      '-r',
      '20',
      '-s',
      '352x288',
      '-vb',
      '400k',
      '-acodec',
      'aac',
      '-strict',
      'experimental',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-ab',
      '24k',
      output,
    ];
  else ffmpeg_cmd = ['-i', input, output];

  // execute cmd
  await ffmpeg.exec(ffmpeg_cmd);

  const data = (await ffmpeg.readFile(output)) as any;
  const blob = new Blob([data], { type: file_type.split('/')[0] });
  const url = URL.createObjectURL(blob);
  return { url, output };
}
