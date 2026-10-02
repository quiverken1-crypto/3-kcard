export function whenDocumentReady(doc, start) {
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
}
