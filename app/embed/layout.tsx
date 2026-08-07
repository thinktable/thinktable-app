// Chrome-less shell for in-item page previews (iframe). Skips board sidebar / nav popup.
// Explicit height (not only min-height) so BoardFlow’s h-full + RF pane fill the iframe —
// min-height alone leaves height:auto and RF shrinks to content, leaving a dead white body.

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body {
          height: 100%;
          width: 100%;
          margin: 0;
          overflow: hidden;
          background: #f9fafb; /* match board gray-50 so underruns aren’t stark white */
        }
        html.dark, html.dark body {
          background: #0f0f0f;
        }
        #tt-embed-root {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
      `}</style>
      <div id="tt-embed-root">{children}</div>
    </>
  )
}
