import type { IconSvgElement } from '@hugeicons/react';
import type { ComponentType } from 'react';

export type CategoryId =
  | 'page-management'
  | 'edit-annotate'
  | 'convert-to-pdf'
  | 'convert-from-pdf'
  | 'security'
  | 'image'
  | 'media'
  | 'ai'
  | 'workflow'
  | 'business'
  | 'share';

export type Category = {
  id: CategoryId;
  title: string;
  /** One line for the category page header and metadata. */
  description: string;
  icon: IconSvgElement;
};

/** Props every tool component receives from the tool page. */
export type ToolProps = {
  tool: ToolInfo;
};

/** A tool module's default export. The module must start with 'use client'. */
export type ToolModule = { default: ComponentType<ToolProps> };
export type ToolLoader = () => Promise<ToolModule>;

type ToolBase = {
  /** URL segment: /tools/<slug>. Lowercase words joined by hyphens; never change once shipped. */
  slug: string;
  title: string;
  /** One sentence; used on cards, in search and as the page's meta description. */
  description: string;
  category: CategoryId;
  /** Extra search terms (formats, synonyms). The title is searched already. */
  keywords: readonly string[];
  icon: IconSvgElement;
  /**
   * Inputs the tool accepts, in the `<input accept>` syntax: extensions
   * (".pdf"), exact MIME types ("application/pdf") or wildcards ("image/*").
   * Empty for tools that take no files.
   */
  accept: readonly string[];
};

/** Registered but not built yet: hidden from navigation, search, the grid and static params. */
export type PlannedTool = ToolBase & { status: 'planned'; load?: undefined };

/** Shipped: listed everywhere and statically generated at /tools/<slug>. */
export type AvailableTool = ToolBase & { status: 'available'; load: ToolLoader };

export type ToolDefinition = PlannedTool | AvailableTool;
export type ToolStatus = ToolDefinition['status'];

/** Serializable tool metadata (no loader), safe to pass from server to client components. */
export type ToolInfo = ToolBase & { status: ToolStatus };
