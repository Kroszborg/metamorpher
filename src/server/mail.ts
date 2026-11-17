import 'server-only';
import { mailConfigured, serverConfig } from './config';
import { SITE_NAME } from '@/lib/site';

type Mail = { to: string; subject: string; intro: string; action: string; url: string; outro: string };

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(m: Mail) {
  const text = `${m.intro}\n\n${m.action}: ${m.url}\n\n${m.outro}\n\n${SITE_NAME}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1b1d17;max-width:32rem;margin:0 auto;padding:24px">
<p style="font-weight:700;font-size:18px;margin:0 0 16px">${escape(SITE_NAME)}</p>
<p>${escape(m.intro)}</p>
<p><a href="${escape(m.url)}" style="display:inline-block;background:#4a6b0a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escape(m.action)}</a></p>
<p style="font-size:13px;color:#5d6153">Or open this link: <br><span style="word-break:break-all">${escape(m.url)}</span></p>
<p style="font-size:13px;color:#5d6153">${escape(m.outro)}</p>
</body></html>`;
  return { text, html };
}

/**
 * Sends a transactional email through Resend's HTTP API. Without a key, in
 * development, the link is printed to the server console instead. Message
 * bodies and API keys are never logged.
 */
async function send(m: Mail): Promise<void> {
  if (!mailConfigured) {
    if (serverConfig.isDev) {
      console.info(`\n[mail:dev] ${m.subject} -> ${m.to}\n[mail:dev] ${m.action}: ${m.url}\n`);
      return;
    }
    throw new Error('Email delivery is not configured.');
  }
  const { text, html } = render(m);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverConfig.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: serverConfig.emailFrom, to: [m.to], subject: m.subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Status only: the response may echo the message.
    console.error(`[mail] Resend rejected a "${m.subject}" email with HTTP ${res.status}.`);
    throw new Error('The email could not be sent.');
  }
}

export function sendVerificationMail(to: string, url: string) {
  return send({
    to,
    subject: `Confirm your email for ${SITE_NAME}`,
    intro: `Confirm this address to finish creating your ${SITE_NAME} account.`,
    action: 'Confirm email',
    url,
    outro: 'If you did not sign up, ignore this email. The link expires in one hour.',
  });
}

export function sendResetMail(to: string, url: string) {
  return send({
    to,
    subject: `Reset your ${SITE_NAME} password`,
    intro: 'Someone (hopefully you) asked to reset the password for this account.',
    action: 'Choose a new password',
    url,
    outro: 'If you did not ask for this, ignore this email; your password stays the same. The link expires in one hour.',
  });
}
