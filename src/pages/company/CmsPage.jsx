import React, { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText } from 'lucide-react';
import { api } from '@/api/client';
import PageContainer from '@/components/common/PageContainer';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import PageNotFound from '@/lib/PageNotFound';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

/**
 * BUG-008: страницы /about, /vacation-policy, /ethics были заведены в CMS,
 * но публичного рендера у них не было — портал отдавал 404.
 * Здесь опубликованная страница читается по слагу и отображается в общем layout.
 *
 * Безопасность: тело страницы редактируют HR через админку, но выводить его через
 * dangerouslySetInnerHTML нельзя — любой <script> или onerror в тексте стал бы XSS.
 * Поэтому ниже — маленький разборщик markdown-подобной разметки, который строит
 * дерево React-элементов. Никакого innerHTML.
 */

/* ------------------------------------------------------ разбор inline-разметки */

/** Возвращает массив узлов: строки и <strong>/<em>. React сам экранирует текст. */
function renderInline(text, keyPrefix) {
  const nodes = [];
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(<em key={`${keyPrefix}-i${index}`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/* -------------------------------------------------------- разбор блочной разметки */

/**
 * Поддерживаются: `# / ## / ###` заголовки, `- ` маркированный список,
 * `1. ` нумерованный список, `> ` цитата, `---` разделитель,
 * пустая строка — граница абзаца.
 */
function parseBlocks(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'p', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ type: `h${heading[1].length}`, text: heading[2] });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushAll();
      blocks.push({ type: 'hr' });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushAll();
      blocks.push({ type: 'quote', text: quote[1] });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

function MarkdownLite({ body }) {
  const blocks = useMemo(() => parseBlocks(body), [body]);

  if (!blocks.length) return null;

  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-foreground">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.type) {
          case 'h1':
            return (
              <h2 key={key} className="text-xl font-bold tracking-tight text-foreground pt-2">
                {renderInline(block.text, key)}
              </h2>
            );
          case 'h2':
            return (
              <h2 key={key} className="text-lg font-semibold tracking-tight text-foreground pt-2">
                {renderInline(block.text, key)}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={key} className="text-base font-semibold text-foreground pt-1">
                {renderInline(block.text, key)}
              </h3>
            );
          case 'ul':
            return (
              <ul key={key} className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground">
                {renderInline(block.text, key)}
              </blockquote>
            );
          case 'hr':
            return <hr key={key} className="border-border" />;
          default:
            return (
              <p key={key} className="text-muted-foreground">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- страница */

function CmsSkeleton() {
  return (
    <Card className="p-6 space-y-3" aria-hidden="true">
      <div className="h-6 w-2/3 rounded bg-muted animate-pulse" />
      <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
      <div className="pt-4 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 rounded bg-muted animate-pulse" style={{ width: `${95 - i * 7}%` }} />
        ))}
      </div>
    </Card>
  );
}

export default function CmsPage() {
  const { slug } = useParams();
  const viewRegistered = useRef(null);

  const {
    data: page,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cms-page', slug],
    queryFn: async () => {
      // BUG-008: статус не фильтруем на клиенте — черновик по правилам RLS вернётся
      // только HR и администратору, обычный сотрудник получит пустой ответ и честный 404.
      const rows = await api.entities.Page.filter({ slug }, null, 1);
      return rows?.[0] || null;
    },
    enabled: !!slug,
  });

  // Счётчик просмотров ведёт сервер (register_page_view). Ошибку глотаем: неудачный
  // счётчик не должен мешать читать страницу. Ref защищает от двойного вызова в StrictMode.
  useEffect(() => {
    if (!slug || !page || viewRegistered.current === slug) return;
    viewRegistered.current = slug;
    api.rpc.registerPageView(slug);
  }, [slug, page]);

  if (error) {
    return (
      <PageContainer title="Страница портала" width="narrow">
        <ErrorState error={error} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer title="Загрузка страницы…" width="narrow">
        <CmsSkeleton />
      </PageContainer>
    );
  }

  // Опубликованной страницы с таким слагом нет — это честный 404 портала (BUG-066).
  if (!page) return <PageNotFound />;

  const hasBody = !!String(page.body || '').trim();

  return (
    <PageContainer title={page.title} width="narrow">
      {/* Предпросмотр из админки: неопубликованную страницу видно только администраторам. */}
      {page.status !== 'published' && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          Черновик: страница видна только администраторам портала. Сотрудники увидят её после публикации.
        </div>
      )}
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-6">
          {page.published_date && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
              Опубликовано {formatDate(page.published_date, 'long')}
            </span>
          )}
          {page.author_name && <span>Автор: {page.author_name}</span>}
        </div>

        {hasBody ? (
          <MarkdownLite body={page.body} />
        ) : (
          <EmptyState
            icon={FileText}
            title="Страница пока пустая"
            description="Раздел создан, но содержимое ещё не опубликовано. Загляните позже."
            compact
          />
        )}
      </Card>
    </PageContainer>
  );
}
