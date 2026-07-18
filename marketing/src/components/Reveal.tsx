'use client';

/** Scroll-linked reveal (spec 010). IntersectionObserver + CSS transitions —
 * deliberately dependency-free (the GSAP ScrollTrigger option in the prompt
 * is satisfied without shipping GSAP; swap the implementation later if
 * heavier choreography is ever needed). Honors prefers-reduced-motion by
 * never entering the hidden state. */
import { useEffect, useRef, useState } from 'react';

export default function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<'initial' | 'hidden' | 'shown'>('initial');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setState('hidden');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('shown');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const Component = Tag as React.ElementType;
  return (
    <Component
      ref={ref}
      className={`${className} ${state === 'hidden' ? 'reveal-hidden' : ''} ${state === 'shown' ? 'reveal-shown' : ''}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Component>
  );
}
