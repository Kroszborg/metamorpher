/**
 * Password rules: long enough, not a well-known password, not mostly one
 * character, not the email address. No composition rules (they push people
 * towards predictable patterns); length does the work.
 */
const COMMON = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  '123456789a',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'asdfghjkl1',
  'password12',
  'password123',
  'password1234',
  'password!1',
  'passw0rd123',
  'passwordpassword',
  'iloveyou12',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'welcome1234',
  'administrator',
  'abcdefghij',
  'abcd123456',
  'abc1234567',
  'changeme123',
  'football123',
  'baseball123',
  'sunshine123',
  'princess123',
  'superman123',
  'metamorpher',
  'metamorpher1',
  'metamorpher123',
]);

const SEQUENCES = ['01234567890123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'].flatMap((s) => [
  s,
  [...s].reverse().join(''),
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Pick something less predictable.';
  if (new Set(lower).size < 5) return 'Use a password with more variety (at least 5 different characters).';
  if (SEQUENCES.some((s) => s.includes(lower))) return 'Avoid simple sequences such as 1234567890 or abcdefghij.';
  const local = email.toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'Do not use your email address in the password.';
  return null;
}
