import type { MDXComponents } from 'mdx/types';

/** Required by @next/mdx (app router). Docs styling is handled by the
 * .docs-content CSS scope, so MDX elements pass through unchanged. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
