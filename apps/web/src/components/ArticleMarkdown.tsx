import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Bài SEO hiển thị như bài thật trên website: tiêu đề, đoạn văn, danh sách, bảng và ẢNH nằm đúng vị trí đã chèn
 * (markdown `![alt](/v1/media/<id>)`). Phần "Meta: … / Từ khóa: …" ở đầu bài được tách ra thành dòng thông tin riêng.
 */
export function ArticleMarkdown({ body, className = "" }: { body: string; className?: string }) {
  const m = /^Meta:\s*([^\n]*)\nTừ khóa:\s*([^\n]*)\n+/.exec(body);
  const md = m ? body.slice(m[0].length) : body;
  return (
    <div className={className}>
      {m && (
        <div className="mb-3 space-y-1 rounded-xl border border-line bg-card p-3 text-xs text-muted">
          <p><b className="font-medium text-ink">Từ khóa chính:</b> {m[2]}</p>
          <p><b className="font-medium text-ink">Meta description</b> ({m[1].length} ký tự): {m[1]}</p>
        </div>
      )}
      <article className="brain-md text-[14.5px] leading-7 text-ink">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(u) => (/^(\/|https?:|mailto:|#)/i.test(u) ? u : "")} components={{
          // Ảnh đứng một mình trong đoạn → <figure> (không lồng <figure> trong <p>)
          p: ({ node, children }) => ((node?.children?.length === 1 && (node.children[0] as { tagName?: string }).tagName === "img") ? <>{children}</> : <p>{children}</p>),
          img: ({ src, alt }) => (
            <figure className="my-4">
              <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={alt} loading="lazy" className="w-full rounded-xl border border-line bg-soft" /></a>
              {alt && <figcaption className="mt-1 text-center text-[11px] text-muted">{alt}</figcaption>}
            </figure>
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{children}</a>,
        }}>{md}</ReactMarkdown>
      </article>
    </div>
  );
}
