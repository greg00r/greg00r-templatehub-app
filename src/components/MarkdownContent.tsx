import React from 'react';
import ReactMarkdown from 'react-markdown';

interface Props {
  content: string;
  className?: string;
}

const MarkdownRenderer = typeof ReactMarkdown === 'function' ? ReactMarkdown : null;

export function MarkdownContent({ content, className }: Props) {
  if (!content) {
    return null;
  }

  if (!MarkdownRenderer) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {content}
      </div>
    );
  }

  return (
    <div className={className}>
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </div>
  );
}
