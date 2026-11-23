/** Lazy KaTeX rendering + sanitised Markdown (with $math$) for AI answers. */
import { useEffect, useState } from 'react';

type Katex = typeof import('katex').default;
let katexP: Promise<Katex> | null = null;
function loadKatex() {
  if (!katexP) katexP = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default);
  return katexP;
}

export function TeX({ tex, block }: { tex: string; block?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadKatex().then((k) => { if (live) setHtml(k.renderToString(tex, { throwOnError: false, displayMode: block, output: 'htmlAndMathml', trust: false })); }).catch(() => setHtml(null));
    return () => { live = false; };
  }, [tex, block]);
  if (!html) return <code className="mono" style={{ color: 'var(--cyan)' }}>{tex}</code>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Markdown from the model → sanitised HTML. Math segments are pulled out first,
 * the Markdown is rendered and sanitised with DOMPurify, then KaTeX HTML (which
 * escapes its input) is inserted for the placeholders.
 */
export async function renderMarkdown(md: string): Promise<string> {
  const [{ marked }, DOMPurify, katex] = await Promise.all([import('marked'), import('dompurify').then((m) => m.default), loadKatex()]);
  const maths: { tex: string; block: boolean }[] = [];
  const withPh = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `@@MATH${maths.push({ tex: t, block: true }) - 1}@@`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => `@@MATH${maths.push({ tex: t, block: true }) - 1}@@`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => `@@MATH${maths.push({ tex: t, block: false }) - 1}@@`)
    .replace(/\$([^$\n]+?)\$/g, (_, t) => `@@MATH${maths.push({ tex: t, block: false }) - 1}@@`);
  const raw = await marked.parse(withPh, { gfm: true, breaks: false });
  const safe = DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['p', 'strong', 'em', 'ol', 'ul', 'li', 'code', 'br', 'blockquote', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td'], ALLOWED_ATTR: [] });
  return safe.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const m = maths[Number(i)];
    return m ? katex.renderToString(m.tex, { throwOnError: false, displayMode: m.block, trust: false, output: 'htmlAndMathml' }) : '';
  });
}

export function Markdown({ md }: { md: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => { let live = true; renderMarkdown(md).then((h) => live && setHtml(h)).catch(() => setHtml(null)); return () => { live = false; }; }, [md]);
  if (html == null) return <p style={{ whiteSpace: 'pre-wrap' }}>{md}</p>;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
