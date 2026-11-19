import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { AVAILABLE_TOOLS } from '@/tools/registry';

export const alt = `${SITE_NAME}: every file tool, nothing uploaded`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const LIME = '#c8f53a';
const INK = '#0b0d04';

/** The link preview card: logo, the home page headline and what the tools cover. */
export default function OpengraphImage() {
  const count = Math.floor(AVAILABLE_TOOLS.length / 10) * 10;
  const chips = ['PDF', 'Images', 'Video & audio', 'Office documents', 'Viewers', 'On-device AI'];
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#0a0b08',
        color: '#f4f5ef',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill={LIME} />
            <g transform="translate(4 4)" fill="none" stroke={INK} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="8" height="8" rx="2" />
              <circle cx="16.5" cy="16.5" r="4.25" />
              <path d="M14.5 4.5h1.5a3 3 0 0 1 3 3V10m-2-2 2 2 2-2" />
              <path d="M9.5 19.5H8a3 3 0 0 1-3-3V14m-2 2 2-2 2 2" />
            </g>
          </svg>
          <div
            style={{
              display: 'flex',
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {SITE_NAME}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#7d8172' }}>{SITE_URL.replace(/^https?:\/\//, '')}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 92,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -3.5,
          }}
        >
          <span>Every file tool.</span>
          <span style={{ color: LIME }}>Nothing uploaded.</span>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#a9ad9d' }}>
          {`${count}+ free tools that run in your browser. Files never leave your device.`}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {chips.map((c) => (
          <div
            key={c}
            style={{
              display: 'flex',
              padding: '9px 18px',
              borderRadius: 999,
              border: '1.5px solid #33372a',
              fontSize: 23,
              color: '#d6d9cb',
            }}
          >
            {c}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
