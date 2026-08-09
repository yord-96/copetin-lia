import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const cacheDirectory = path.resolve(
  process.env.DOCUMENT_PDF_CACHE_DIR
    ?? path.join(projectRoot, 'data', 'generated-documents', 'pdf-cache'),
);
const browserUserDataDirectory = path.resolve(
  process.env.CHROMIUM_USER_DATA_DIR
    ?? path.join(projectRoot, 'data', 'chromium-profile'),
);
const chromiumDiskCacheBytes = Math.max(
  0,
  Number.parseInt(process.env.CHROMIUM_DISK_CACHE_BYTES ?? '52428800', 10) || 0,
);
const chromiumMediaCacheBytes = Math.max(
  0,
  Number.parseInt(process.env.CHROMIUM_MEDIA_CACHE_BYTES ?? '10485760', 10) || 0,
);

const executableCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : '',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    : '',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

let browserPromise = null;
let browserInstance = null;

const findExecutablePath = async () => {
  for (const candidate of executableCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known Chromium path.
    }
  }

  const error = new Error(
    'Chromium no está instalado o no fue configurado. Define CHROMIUM_EXECUTABLE_PATH.',
  );
  error.code = 'CHROMIUM_NOT_AVAILABLE';
  error.statusCode = 503;
  throw error;
};

const launchBrowser = async () => {
  const [{ default: puppeteer }, executablePath] = await Promise.all([
    import('puppeteer-core'),
    findExecutablePath(),
  ]);
  await fs.mkdir(browserUserDataDirectory, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath,
    userDataDir: browserUserDataDirectory,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
      `--disk-cache-size=${chromiumDiskCacheBytes}`,
      `--media-cache-size=${chromiumMediaCacheBytes}`,
    ],
  });
  browserInstance = browser;

  browser.on('disconnected', () => {
    if (browserInstance === browser) {
      browserInstance = null;
      browserPromise = null;
    }
  });

  return browser;
};

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
};

const sanitizeFileName = (value) =>
  String(value ?? 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
    || 'documento';

const injectBaseUrl = (html, baseUrl) => {
  const safeBaseUrl = String(baseUrl ?? '').trim();
  if (!safeBaseUrl) return html;

  const escaped = safeBaseUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  const baseTag = `<base href="${escaped.replace(/\/?$/, '/')}" />`;

  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${baseTag}`);
  }
  return `${baseTag}${html}`;
};

const waitForDocumentAssets = async (page) => {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }

    const pendingImages = [...document.images]
      .filter((image) => !image.complete)
      .map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      }));

    if (pendingImages.length) {
      await Promise.race([
        Promise.all(pendingImages),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    }
  });
};

export const ensureDocumentPdfCacheDirectory = async () => {
  await Promise.all([
    fs.mkdir(cacheDirectory, { recursive: true }),
    fs.mkdir(browserUserDataDirectory, { recursive: true }),
  ]);
  return cacheDirectory;
};

export const closeDocumentPdfRenderer = async () => {
  const pendingBrowser = browserPromise;
  browserPromise = null;
  if (!pendingBrowser) return;

  try {
    const browser = await pendingBrowser;
    if (browser?.connected) {
      await browser.close();
    }
  } finally {
    browserInstance = null;
  }
};

export const warmDocumentPdfRenderer = async () => {
  await ensureDocumentPdfCacheDirectory();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
  } finally {
    await page.close();
  }
};

export const renderHtmlDocumentToPdf = async ({
  html,
  baseUrl = '',
  fileName = 'documento',
}) => {
  const sourceHtml = String(html ?? '');
  if (!sourceHtml.trim()) {
    const error = new Error('El documento HTML está vacío.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedFileName = sanitizeFileName(fileName);
  const renderedHtml = injectBaseUrl(sourceHtml, baseUrl);
  const cacheKey = crypto
    .createHash('sha256')
    .update(renderedHtml)
    .digest('hex');
  const cachePath = path.join(cacheDirectory, `${normalizedFileName}-${cacheKey}.pdf`);

  await ensureDocumentPdfCacheDirectory();

  try {
    const cachedPdf = await fs.readFile(cachePath);
    return {
      buffer: cachedPdf,
      cacheHit: true,
      cacheKey,
      fileName: `${normalizedFileName}.pdf`,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(renderedHtml, {
      waitUntil: 'domcontentloaded',
      timeout: Number(process.env.DOCUMENT_RENDER_TIMEOUT_MS ?? 15000),
    });
    await page.emulateMediaType('print');
    await waitForDocumentAssets(page);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    const pdfBuffer = Buffer.from(pdf);
    const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, pdfBuffer);
    await fs.rename(temporaryPath, cachePath);

    return {
      buffer: pdfBuffer,
      cacheHit: false,
      cacheKey,
      fileName: `${normalizedFileName}.pdf`,
    };
  } finally {
    await page.close();
  }
};
