'use client';

/**
 * Central icon wrapper (spec 008). ALL app iconography goes through this
 * semantic-name → Bootstrap Icon map, so swapping the icon set (or a single
 * glyph) is a one-file change. Icons inherit `currentColor`, so design-token
 * colors apply automatically.
 *
 * Usage: <Icon name="webhook" />  ·  <Icon name="delete" size={14} />
 */
import type { CSSProperties } from 'react';
import {
  ArrowClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookHalf,
  BoxArrowUpRight,
  Boxes,
  Braces,
  Bricks,
  Broadcast,
  Bullseye,
  Calendar3,
  CameraVideo,
  CardHeading,
  Check2,
  CheckCircle,
  ClockHistory,
  CreditCard,
  Diagram3,
  Envelope,
  ExclamationTriangle,
  Eye,
  EyeSlash,
  FileEarmarkPdf,
  FileEarmarkText,
  Folder2Open,
  Fonts,
  Globe2,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Images,
  JournalText,
  JustifyLeft,
  Key,
  Lightbulb,
  Link45deg,
  Link as LinkIcon,
  ListUl,
  Lock,
  Newspaper,
  Paperclip,
  Pencil,
  PencilSquare,
  People,
  PlusLg,
  Search,
  ShieldLock,
  Slash,
  StarFill,
  Stars,
  TextParagraph,
  ToggleOn,
  Translate,
  Trash,
  Upload,
  X,
} from 'react-bootstrap-icons';

export const ICONS = {
  // Navigation / resources
  'content-model': Boxes,
  content: FileEarmarkText,
  media: Images,
  guidelines: BookHalf,
  locale: Globe2,
  'api-key': Key,
  environment: Diagram3,
  webhook: Broadcast,
  users: People,
  security: ShieldLock,
  billing: CreditCard,
  audit: JournalText,
  // Actions
  edit: PencilSquare,
  'edit-inline': Pencil,
  delete: Trash,
  add: PlusLg,
  close: X,
  check: Check2,
  publish: CheckCircle,
  history: ClockHistory,
  restore: ArrowClockwise,
  reload: ArrowClockwise,
  'open-external': BoxArrowUpRight,
  upload: Upload,
  search: Search,
  drag: GripVertical,
  'move-up': ArrowUp,
  'move-down': ArrowDown,
  back: ArrowLeft,
  forward: ArrowRight,
  'inspector-on': Eye,
  'inspector-off': EyeSlash,
  // AI
  generate: Stars,
  'suggest-titles': Lightbulb,
  seo: Search,
  translate: Translate,
  compliance: CheckCircle,
  // Field types (FIELD_TYPE_INFO)
  'field-text': Fonts,
  'field-longtext': TextParagraph,
  'field-richtext': JustifyLeft,
  'field-number': Hash,
  'field-boolean': ToggleOn,
  'field-datetime': Calendar3,
  'field-select': ListUl,
  'field-media': ImageIcon,
  'field-media-many': Images,
  'field-reference': Link45deg,
  'field-reference-many': LinkIcon,
  'field-json': Braces,
  'field-slug': Slash,
  // Media kinds
  'media-image': ImageIcon,
  'media-video': CameraVideo,
  'media-pdf': FileEarmarkPdf,
  'media-file': Paperclip,
  // Misc / status
  star: StarFill,
  warning: ExclamationTriangle,
  lock: Lock,
  email: Envelope,
  // Content-type card cycle
  'type-0': Boxes,
  'type-1': FileEarmarkText,
  'type-2': Bricks,
  'type-3': CardHeading,
  'type-4': Newspaper,
  'type-5': Bullseye,
  'type-6': Folder2Open,
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({
  name,
  size = 16,
  className,
  style,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const Component = ICONS[name];
  return (
    <Component
      size={size}
      className={className}
      style={{ flexShrink: 0, ...style }}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
