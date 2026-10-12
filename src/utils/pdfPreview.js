// The authenticated download is already complete. Keep the viewer on those
// bytes rather than a server URL whose access token expires while it is open.
export function createPdfPreview(pdfBlob, urlApi = URL) {
  if (pdfBlob.type && pdfBlob.type !== 'application/pdf') {
    throw new Error('El servidor no devolvio un documento PDF valido.');
  }
  const blobUrl = urlApi.createObjectURL(pdfBlob);
  return { blobUrl, viewerUrl: blobUrl };
}
