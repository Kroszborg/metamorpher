/** Résumé model: sections and entries, defaults, JSON import/export and the local draft. */
import { newId } from '@/lib/files';

export type SectionKind = 'summary' | 'experience' | 'education' | 'projects' | 'skills' | 'links' | 'custom';
export type TemplateId = 'modern' | 'classic' | 'compact' | 'sidebar';
export type FontId = 'sans' | 'serif' | 'calibri';
export type PaperId = 'a4' | 'letter';

/**
 * One entry. Fields are used per kind: experience = role, company, place,
 * dates, bullet lines; education = degree, school…; skills = group + list;
 * links = label + URL. `text`: lines starting with "-" or "•" are bullets.
 */
export type Entry = { id: string; title: string; org: string; location: string; start: string; end: string; url: string; text: string };

export type Section = { id: string; kind: SectionKind; title: string; hidden: boolean; entries: Entry[] };

export type Profile = { name: string; headline: string; email: string; phone: string; location: string; website: string; linkedin: string; github: string };

export type Spacing = 'compact' | 'normal' | 'relaxed';
export type Margins = 'narrow' | 'normal' | 'wide';

export type Resume = {
  v: 1;
  template: TemplateId;
  accent: string;
  paper: PaperId;
  font: FontId;
  size: 'small' | 'medium' | 'large';
  spacing: Spacing;
  margins: Margins;
  profile: Profile;
  sections: Section[];
};

export const KIND_LABEL: Record<SectionKind, string> = {
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  links: 'Links',
  custom: 'Custom section',
};

export const ACCENTS = ['#1f4e79', '#0f766e', '#9a3412', '#4a6b0a', '#6d28d9', '#111827'] as const;

export function newEntry(p: Partial<Entry> = {}): Entry {
  return { id: newId('e'), title: '', org: '', location: '', start: '', end: '', url: '', text: '', ...p };
}

export function newSection(kind: SectionKind, title = KIND_LABEL[kind]): Section {
  return { id: newId('s'), kind, title: kind === 'custom' ? 'Certifications' : title, hidden: false, entries: [newEntry()] };
}

export function sampleResume(): Resume {
  return {
    v: 1,
    template: 'modern',
    accent: ACCENTS[0],
    paper: 'a4',
    font: 'sans',
    size: 'medium',
    spacing: 'normal',
    margins: 'normal',
    profile: {
      name: 'Priya Sharma',
      headline: 'Senior Frontend Engineer',
      email: 'priya.sharma@example.com',
      phone: '+91 98765 43210',
      location: 'Bengaluru, India',
      website: 'priya.dev',
      linkedin: 'linkedin.com/in/priyasharma',
      github: 'github.com/priyasharma',
    },
    sections: [
      {
        id: newId('s'),
        kind: 'summary',
        title: 'Summary',
        hidden: false,
        entries: [newEntry({ text: 'Frontend engineer with 7 years of experience building fast, accessible web apps in React and TypeScript. Led a design-system rollout used by 40 engineers and cut page load times by 45%.' })],
      },
      {
        id: newId('s'),
        kind: 'experience',
        title: 'Experience',
        hidden: false,
        entries: [
          newEntry({
            title: 'Senior Frontend Engineer',
            org: 'Kite Payments',
            location: 'Bengaluru',
            start: 'Jan 2022',
            end: 'Present',
            text: '- Led the migration of the merchant dashboard to Next.js; first load 3.1 s → 1.7 s.\n- Built the shared component library (60 components, WCAG 2.2 AA) used by 6 product teams.\n- Mentored 5 engineers; introduced visual regression tests that caught 30+ UI bugs before release.',
          }),
          newEntry({
            title: 'Frontend Engineer',
            org: 'ShopLane',
            location: 'Pune',
            start: 'Jul 2018',
            end: 'Dec 2021',
            text: '- Rebuilt checkout in React with server-side validation; conversion up 8%.\n- Shipped offline support for the field-sales app used by 2,000 agents.',
          }),
        ],
      },
      {
        id: newId('s'),
        kind: 'projects',
        title: 'Projects',
        hidden: false,
        entries: [
          newEntry({ title: 'tiny-charts', url: 'github.com/priyasharma/tiny-charts', start: '2023', text: '- 3 KB SVG chart library; 1.2k GitHub stars.' }),
        ],
      },
      {
        id: newId('s'),
        kind: 'education',
        title: 'Education',
        hidden: false,
        entries: [newEntry({ title: 'B.Tech, Computer Science', org: 'National Institute of Technology, Karnataka', location: 'Surathkal', start: '2014', end: '2018', text: 'CGPA 8.7 / 10' })],
      },
      {
        id: newId('s'),
        kind: 'skills',
        title: 'Skills',
        hidden: false,
        entries: [
          newEntry({ title: 'Languages', text: 'TypeScript, JavaScript, HTML, CSS, SQL' }),
          newEntry({ title: 'Frameworks', text: 'React, Next.js, Node.js, Playwright, Vitest' }),
          newEntry({ title: 'Practices', text: 'Accessibility, performance, design systems, CI/CD' }),
        ],
      },
    ],
  };
}

export function emptyResume(): Resume {
  return {
    ...sampleResume(),
    profile: { name: '', headline: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' },
    sections: (['summary', 'experience', 'education', 'skills'] as const).map((k) => newSection(k)),
  };
}

// ── JSON ──────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const KINDS = Object.keys(KIND_LABEL) as SectionKind[];

export function normalizeResume(raw: unknown): Resume {
  const o = obj(raw);
  const d = sampleResume();
  const p = obj(o.profile);
  const sections = Array.isArray(o.sections)
    ? o.sections.slice(0, 40).map((x) => {
        const s = obj(x);
        const kind = KINDS.find((k) => k === s.kind) ?? 'custom';
        return {
          id: newId('s'),
          kind,
          title: str(s.title, 120) || KIND_LABEL[kind],
          hidden: s.hidden === true,
          entries: (Array.isArray(s.entries) ? s.entries : []).slice(0, 80).map((e) => {
            const en = obj(e);
            return newEntry({
              title: str(en.title, 300),
              org: str(en.org, 300),
              location: str(en.location, 200),
              start: str(en.start, 60),
              end: str(en.end, 60),
              url: str(en.url, 500),
              text: str(en.text, 8000),
            });
          }),
        } satisfies Section;
      })
    : d.sections;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === v) ?? fallback;
  return {
    v: 1,
    template: pick(o.template, ['modern', 'classic', 'compact', 'sidebar'] as const, d.template),
    accent: /^#[0-9a-fA-F]{6}$/.test(str(o.accent)) ? str(o.accent) : d.accent,
    paper: pick(o.paper, ['a4', 'letter'] as const, d.paper),
    font: pick(o.font, ['sans', 'serif', 'calibri'] as const, d.font),
    size: pick(o.size, ['small', 'medium', 'large'] as const, 'medium'),
    spacing: pick(o.spacing, ['compact', 'normal', 'relaxed'] as const, 'normal'),
    margins: pick(o.margins, ['narrow', 'normal', 'wide'] as const, 'normal'),
    profile: {
      name: str(p.name, 200),
      headline: str(p.headline, 200),
      email: str(p.email, 200),
      phone: str(p.phone, 80),
      location: str(p.location, 200),
      website: str(p.website, 300),
      linkedin: str(p.linkedin, 300),
      github: str(p.github, 300),
    },
    sections,
  };
}

export function parseResume(text: string): Resume {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (obj(raw).kind !== 'metamorpher-resume') throw new Error('This JSON is not a résumé saved by this tool.');
  return normalizeResume(raw);
}

export function serializeResume(r: Resume): string {
  return JSON.stringify(
    { kind: 'metamorpher-resume', ...r, sections: r.sections.map(({ id: _i, ...s }) => ({ ...s, entries: s.entries.map(({ id: _e, ...e }) => e) })) },
    null,
    2,
  );
}

const DRAFT_KEY = 'metamorpher:resume-draft';

export function loadDraft(): Resume | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? parseResume(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(r: Resume): void {
  try {
    localStorage.setItem(DRAFT_KEY, serializeResume(r));
  } catch {
    // Storage full or blocked: the draft lasts until the tab closes.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
