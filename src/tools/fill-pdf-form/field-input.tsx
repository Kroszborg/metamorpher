'use client';

import type * as React from 'react';
import type { FieldValue, FormField } from '@/engines/pdf-stamp';
import { cn } from '@/lib/utils';

export type FieldInputProps = {
  field: FormField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  /** For a radio widget: the option this widget selects. */
  option?: string;
  /** 'page': sized to a widget on the page; 'list': a row in the side panel. */
  variant: 'page' | 'list';
  /** Font size in CSS px for the 'page' variant. */
  fontSize?: number;
  style?: React.CSSProperties;
  id?: string;
};

const PAGE = 'size-full rounded-[2px] [color-scheme:light] border border-sky-500/50 bg-sky-100/70 text-black outline-none focus:border-sky-600 focus:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60';
const LIST =
  'w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60';

/** One HTML control for a PDF form field (or for one radio widget of it). */
export function FieldInput({ field, value, onChange, option, variant, fontSize, style, id }: FieldInputProps) {
  const page = variant === 'page';
  const text = typeof value === 'string' ? value : '';
  const label = field.name;
  const common = { id, disabled: field.readOnly, 'aria-label': option ? `${label}: ${option}` : label, title: label };
  const textStyle: React.CSSProperties = page ? { fontSize, lineHeight: 1.15, padding: '0 0.25em', ...style } : (style ?? {});

  if (field.type === 'checkbox') {
    return (
      <input
        {...common}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className={page ? 'm-0 size-full cursor-pointer accent-sky-600 [color-scheme:light]' : 'size-4 accent-primary'}
        style={style}
      />
    );
  }

  if (field.type === 'radio') {
    if (option === undefined) {
      // Side panel: one select for the whole group.
      return (
        <select {...common} value={text} onChange={(e) => onChange(e.currentTarget.value)} className={LIST} style={style}>
          <option value="">None</option>
          {[...new Set(field.options)].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...common}
        type="radio"
        name={`pdf-field-${field.name}`}
        checked={text === option}
        onChange={() => onChange(option)}
        onClick={() => {
          if (text === option) onChange('');
        }}
        className="m-0 size-full cursor-pointer accent-sky-600 [color-scheme:light]"
        style={style}
      />
    );
  }

  if (field.type === 'dropdown') {
    if (field.editable) {
      const listId = `pdf-options-${variant}-${field.name}`;
      return (
        <>
          <input
            {...common}
            list={listId}
            value={text}
            onChange={(e) => onChange(e.currentTarget.value)}
            className={page ? PAGE : LIST}
            style={textStyle}
          />
          <datalist id={listId}>
            {field.options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      );
    }
    return (
      <select
        {...common}
        value={text}
        onChange={(e) => onChange(e.currentTarget.value)}
        className={page ? cn(PAGE, 'cursor-pointer') : LIST}
        style={textStyle}
      >
        <option value="">{page ? '' : 'None'}</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'list') {
    const selected = Array.isArray(value) ? value : text ? [text] : [];
    return (
      <select
        {...common}
        multiple
        value={selected}
        onChange={(e) => {
          const picked = [...e.currentTarget.selectedOptions].map((o) => o.value);
          onChange(field.multiSelect ? picked : (picked.at(-1) ?? ''));
        }}
        className={page ? PAGE : cn(LIST, 'h-auto')}
        size={page ? undefined : Math.min(5, Math.max(2, field.options.length))}
        style={textStyle}
      >
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'text') {
    if (field.multiline) {
      return (
        <textarea
          {...common}
          value={text}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={page ? cn(PAGE, 'resize-none') : cn(LIST, 'min-h-14 resize-y')}
          style={textStyle}
        />
      );
    }
    return (
      <input
        {...common}
        value={text}
        maxLength={field.maxLength}
        onChange={(e) => onChange(e.currentTarget.value)}
        className={page ? PAGE : LIST}
        style={textStyle}
      />
    );
  }

  return null;
}
