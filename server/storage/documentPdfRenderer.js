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
const browserUserDataRoot = path.resolve(
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
let browserProfileDirectory = null;
let browserLaunchSerial = 0;

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


const isBrowserConnected = (browser) => Boolean(
  browser && (typeof browser.isConnected === 'function' ? browser.isConnected() : browser.connected),
);

const isRecoverableBrowserError = (error) => {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const name = String(error?.name ?? '').toLowerCase();
  return (
    name.includes('connectionclosed')
    || name.includes('targetclose')
    || name.includes('protocolerror')
    || message.includes('connection closed')
    || message.includes('target closed')
    || message.includes('browser has disconnected')
    || message.includes('session closed')
    || message.includes('protocol error')
    || message.includes('the browser is already running')
  );
};

const removeBrowserProfile = async (profileDirectory) => {
  if (!profileDirectory) return;
  await fs.rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
};

const disposeBrowser = async (browser, profileDirectory) => {
  if (browser) {
    try {
      if (isBrowserConnected(browser)) {
        await browser.close();
      }
    } catch {
      try {
        browser.process()?.kill?.('SIGKILL');
      } catch {
        // Best effort: the process may already be gone.
      }
    }
  }
  await removeBrowserProfile(profileDirectory);
};

const invalidateBrowser = async (browser = browserInstance) => {
  const profileDirectory = browserProfileDirectory;
  if (!browser || browserInstance === browser) {
    browserInstance = null;
    browserPromise = null;
    browserProfileDirectory = null;
  }
  await disposeBrowser(browser, profileDirectory);
};

const launchBrowser = async () => {
  const [{ default: puppeteer }, executablePath] = await Promise.all([
    import('puppeteer-core'),
    findExecutablePath(),
  ]);

  const profileParent = path.dirname(browserUserDataRoot);
  const profilePrefix = `${path.basename(browserUserDataRoot)}-${process.pid}-${++browserLaunchSerial}-`;
  await fs.mkdir(profileParent, { recursive: true });
  const profileDirectory = await fs.mkdtemp(path.join(profileParent, profilePrefix));

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      userDataDir: profileDirectory,
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
  } catch (error) {
    await removeBrowserProfile(profileDirectory);
    throw error;
  }

  browserInstance = browser;
  browserProfileDirectory = profileDirectory;

  browser.on('disconnected', () => {
    if (browserInstance === browser) {
      const disconnectedProfile = browserProfileDirectory;
      browserInstance = null;
      browserPromise = null;
      browserProfileDirectory = null;
      removeBrowserProfile(disconnectedProfile).catch(() => {});
    }
  });

  return browser;
};

const getBrowser = async () => {
  if (browserInstance && isBrowserConnected(browserInstance)) {
    return browserInstance;
  }

  if (browserInstance && !isBrowserConnected(browserInstance)) {
    await invalidateBrowser(browserInstance);
  }

  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }

  const browser = await browserPromise;
  if (!isBrowserConnected(browser)) {
    await invalidateBrowser(browser);
    throw new Error('El motor Chromium se desconectó durante el arranque.');
  }
  return browser;
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

const normalizeImageOptimization = (value) => {
  if (!value || typeof value !== 'object') return null;

  const selector = String(value.selector ?? '').trim();
  if (!selector) return null;

  const maxWidth = Math.max(32, Math.min(1024, Number(value.maxWidth) || 180));
  const maxHeight = Math.max(32, Math.min(1024, Number(value.maxHeight) || 180));
  const quality = Math.max(0.35, Math.min(0.95, Number(value.quality) || 0.72));
  const mimeType = value.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';

  return {
    selector,
    maxWidth: Math.round(maxWidth),
    maxHeight: Math.round(maxHeight),
    quality,
    mimeType,
  };
};

const optimizeDocumentImages = async (page, options) => {
  const normalized = normalizeImageOptimization(options);
  if (!normalized) return { optimizedCount: 0, sourcePixelCount: 0, outputPixelCount: 0 };

  return page.evaluate(async (config) => {
    const images = [...document.querySelectorAll(config.selector)];
    let optimizedCount = 0;
    let sourcePixelCount = 0;
    let outputPixelCount = 0;

    for (const image of images) {
      const sourceWidth = Number(image.naturalWidth || image.width || 0);
      const sourceHeight = Number(image.naturalHeight || image.height || 0);
      if (!sourceWidth || !sourceHeight) continue;

      const scale = Math.min(
        1,
        config.maxWidth / sourceWidth,
        config.maxHeight / sourceHeight,
      );
      if (scale >= 0.98) continue;

      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) continue;

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.drawImage(image, 0, 0, targetWidth, targetHeight);

      let optimizedSource = '';
      try {
        optimizedSource = canvas.toDataURL(config.mimeType, config.quality);
      } catch {
        continue;
      }
      if (!optimizedSource) continue;

      await new Promise((resolve) => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        image.src = optimizedSource;
        if (image.complete) resolve();
      });

      optimizedCount += 1;
      sourcePixelCount += sourceWidth * sourceHeight;
      outputPixelCount += targetWidth * targetHeight;
    }

    return { optimizedCount, sourcePixelCount, outputPixelCount };
  }, normalized);
};

export const ensureDocumentPdfCacheDirectory = async () => {
  await Promise.all([
    fs.mkdir(cacheDirectory, { recursive: true }),
    fs.mkdir(path.dirname(browserUserDataRoot), { recursive: true }),
  ]);
  return cacheDirectory;
};

export const closeDocumentPdfRenderer = async () => {
  const pendingBrowser = browserPromise;
  const currentBrowser = browserInstance;
  const profileDirectory = browserProfileDirectory;

  browserPromise = null;
  browserInstance = null;
  browserProfileDirectory = null;

  let browser = currentBrowser;
  if (!browser && pendingBrowser) {
    try {
      browser = await pendingBrowser;
    } catch {
      browser = null;
    }
  }

  await disposeBrowser(browser, profileDirectory);
};

export const warmDocumentPdfRenderer = async () => {
  await ensureDocumentPdfCacheDirectory();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let browser = null;
    let page = null;
    try {
      browser = await getBrowser();
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body></body></html>', {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
      return;
    } catch (error) {
      if (attempt === 0 && isRecoverableBrowserError(error)) {
        await invalidateBrowser(browser);
        continue;
      }
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }
};

export const renderHtmlDocumentToPdf = async ({
  html,
  baseUrl = '',
  fileName = 'documento',
  imageOptimization = null,
}) => {
  const sourceHtml = String(html ?? '');
  if (!sourceHtml.trim()) {
    const error = new Error('El documento HTML está vacío.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedFileName = sanitizeFileName(fileName);
  const renderedHtml = injectBaseUrl(sourceHtml, baseUrl);
  const normalizedImageOptimization = normalizeImageOptimization(imageOptimization);
  const cacheSignature = normalizedImageOptimization
    ? `\n<!-- image-optimization:${JSON.stringify(normalizedImageOptimization)} -->`
    : '';
  const cacheKey = crypto
    .createHash('sha256')
    .update(renderedHtml)
    .update(cacheSignature)
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let browser = null;
    let page = null;
    try {
      browser = await getBrowser();
      page = await browser.newPage();

      await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
      await page.setContent(renderedHtml, {
        waitUntil: 'domcontentloaded',
        timeout: Number(process.env.DOCUMENT_RENDER_TIMEOUT_MS ?? 15000),
      });
      await page.emulateMediaType('print');
      await waitForDocumentAssets(page);
      const imageOptimizationStats = await optimizeDocumentImages(
        page,
        normalizedImageOptimization,
      );

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
      const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.${attempt}.tmp`;
      await fs.writeFile(temporaryPath, pdfBuffer);
      await fs.rename(temporaryPath, cachePath);

      return {
        buffer: pdfBuffer,
        cacheHit: false,
        cacheKey,
        fileName: `${normalizedFileName}.pdf`,
        imageOptimizationStats,
      };
    } catch (error) {
      if (attempt === 0 && isRecoverableBrowserError(error)) {
        await invalidateBrowser(browser);
        continue;
      }
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  throw new Error('No se pudo generar el PDF después de reiniciar Chromium.');
};
