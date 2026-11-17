/** User-facing errors shared by the pdf.js and pdf-lib sides of the PDF engine. */

/** Marker the UI can look for to offer the unlock tool. */
export const PASSWORD_PROTECTED = 'is password-protected';

export function passwordMessage(name: string): string {
  return `${name} ${PASSWORD_PROTECTED}. Remove the password with Unlock PDF first, then try again.`;
}

export function unreadableMessage(name: string, detail: string): string {
  return `${name} could not be read as a PDF (${detail}).`;
}
