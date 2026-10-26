import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT_DIR = path.resolve('.');

/**
 * Creates a lightweight local HTTP server to serve dashboard assets
 * avoiding file:// origin null CORS restrictions for ES modules.
 */
function createStaticServer() {
  const server = http.createServer((req, res) => {
    const safePath = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png'
      };
      res.writeHead(200, {
        'Content-Type': contentTypes[ext] || 'text/plain',
        'Cache-Control': 'no-store'
      });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

test('Playwright UI — Dashboard Diagnostics Tab renders correctly under all states', async (t) => {
  const staticServer = await createStaticServer();
  const dashboardUrl = `http://127.0.0.1:${staticServer.port}/src/dashboard/index.html`;

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });

  await t.test('1. Empty diagnostics state rendering', async () => {
    const page = await browser.newPage();

    // Mock chrome.runtime.sendMessage returning empty diagnostics
    await page.addInitScript(() => {
      window.chrome = {
        runtime: {
          sendMessage: (msg, cb) => {
            if (msg.type === 'GET_DIAGNOSTICS') {
              cb({
                success: true,
                data: {
                  metrics: {
                    recovery: { rate: null, successful: 0, total: 0, hasData: false },
                    latency: { p50: null, p95: null, sampleCount: 0, hasData: false },
                    runtimeErrors: { count: 0 },
                    buffer: { retainedEvents: 0, capacity: 100 }
                  },
                  events: []
                }
              });
            } else {
              cb({ success: true, data: {} });
            }
          }
        },
        storage: {
          local: { getBytesInUse: (keys, cb) => cb(0) }
        }
      };
    });

    await page.goto(dashboardUrl);

    // Click Diagnostics tab
    await page.click('#navDiagnostics');

    // Verify panel is visible
    const isPanelVisible = await page.isVisible('#panelDiagnostics');
    assert.equal(isPanelVisible, true);

    // Verify metrics show placeholder values when no data exists
    const recoveryText = await page.textContent('#diagRecoveryRate');
    assert.equal(recoveryText.trim(), '—');

    const latencyText = await page.textContent('#diagLatencyP50');
    assert.equal(latencyText.trim(), '—');

    const errorCount = await page.textContent('#diagRuntimeErrors');
    assert.equal(errorCount.trim(), '0');

    const bufferStatus = await page.textContent('#diagBufferStatus');
    assert.equal(bufferStatus.trim(), '0 / 100');

    // Verify empty state is displayed and table is hidden
    const emptyStateVisible = await page.isVisible('#diagEmptyState');
    assert.equal(emptyStateVisible, true);

    const tableVisible = await page.isVisible('#diagTableWrapper');
    assert.equal(tableVisible, false);

    await page.close();
  });

  await t.test('2. Populated diagnostics and privacy boundary verification', async () => {
    const page = await browser.newPage();

    const mockEvents = [
      {
        id: 'diag-1',
        type: 'sw_recovery',
        timestamp: Date.now() - 60000,
        outcome: 'success',
        details: 'Active session restored from checkpoint'
      },
      {
        id: 'diag-2',
        type: 'storage_write_error',
        timestamp: Date.now() - 30000,
        outcome: 'failure',
        errorCode: 'QUOTA_EXCEEDED',
        details: 'Local storage write encountered an error'
      },
      {
        id: 'diag-3',
        type: 'runtime_error',
        timestamp: Date.now() - 10000,
        outcome: 'failure',
        errorCode: 'STORAGE_ERROR',
        details: 'Chrome runtime error occurred'
      }
    ];

    await page.addInitScript((events) => {
      window.chrome = {
        runtime: {
          sendMessage: (msg, cb) => {
            if (msg.type === 'GET_DIAGNOSTICS') {
              cb({
                success: true,
                data: {
                  metrics: {
                    recovery: { rate: 100.0, successful: 12, total: 12, hasData: true },
                    latency: { p50: 2.45, p95: 5.80, sampleCount: 42, hasData: true },
                    runtimeErrors: { count: 2 },
                    buffer: { retainedEvents: 3, capacity: 100 }
                  },
                  events
                }
              });
            } else {
              cb({ success: true, data: {} });
            }
          }
        },
        storage: {
          local: { getBytesInUse: (keys, cb) => cb(1024) }
        }
      };
    }, mockEvents);

    await page.goto(dashboardUrl);
    await page.click('#navDiagnostics');

    // Verify populated metrics
    const recoveryText = await page.textContent('#diagRecoveryRate');
    assert.equal(recoveryText.trim(), '100%');

    const recoveryCount = await page.textContent('#diagRecoveryCount');
    assert.ok(recoveryCount.includes('12 / 12 attempts'));

    const latencyP50 = await page.textContent('#diagLatencyP50');
    assert.equal(latencyP50.trim(), '2.45 ms');

    const latencyP95 = await page.textContent('#diagLatencyP95');
    assert.ok(latencyP95.includes('5.8 ms') || latencyP95.includes('5.80 ms'));

    const errorCount = await page.textContent('#diagRuntimeErrors');
    assert.equal(errorCount.trim(), '2');

    const bufferStatus = await page.textContent('#diagBufferStatus');
    assert.equal(bufferStatus.trim(), '3 / 100');

    // Verify table is visible and has 3 rows
    const tableVisible = await page.isVisible('#diagTableWrapper');
    assert.equal(tableVisible, true);

    const rowCount = await page.locator('#diagEventsList tr').count();
    assert.equal(rowCount, 3);

    // Verify privacy: assert no URLs, titles, or browsing domains appear in table
    const tableHtml = await page.innerHTML('#diagEventsList');
    assert.equal(tableHtml.includes('https://'), false);
    assert.equal(tableHtml.includes('http://'), false);
    assert.equal(tableHtml.includes('google.com'), false);
    assert.equal(tableHtml.includes('github.com'), false);

    // Verify badge classes
    const successBadges = await page.locator('.diag-badge.badge-success').count();
    const failureBadges = await page.locator('.diag-badge.badge-failure').count();
    assert.equal(successBadges, 1);
    assert.equal(failureBadges, 2);

    await page.close();
  });

  await t.test('3. Clear diagnostic history user interaction', async () => {
    const page = await browser.newPage();
    let clearDispatched = false;

    await page.addInitScript(() => {
      let cleared = false;
      window.chrome = {
        runtime: {
          sendMessage: (msg, cb) => {
            if (msg.type === 'CLEAR_DIAGNOSTICS') {
              cleared = true;
              window.__clearDispatched = true;
              cb({ success: true });
            } else if (msg.type === 'GET_DIAGNOSTICS') {
              if (cleared) {
                cb({
                  success: true,
                  data: {
                    metrics: {
                      recovery: { rate: null, successful: 0, total: 0, hasData: false },
                      latency: { p50: null, p95: null, sampleCount: 0, hasData: false },
                      runtimeErrors: { count: 0 },
                      buffer: { retainedEvents: 1, capacity: 100 }
                    },
                    events: [
                      {
                        id: 'diag-clear',
                        type: 'diagnostics_cleared',
                        timestamp: Date.now(),
                        outcome: 'info',
                        details: 'Diagnostic history cleared by user'
                      }
                    ]
                  }
                });
              } else {
                cb({
                  success: true,
                  data: {
                    metrics: {
                      recovery: { rate: 80.0, successful: 4, total: 5, hasData: true },
                      latency: { p50: 3.1, p95: 4.2, sampleCount: 10, hasData: true },
                      runtimeErrors: { count: 1 },
                      buffer: { retainedEvents: 5, capacity: 100 }
                    },
                    events: [{ id: '1', type: 'sw_recovery', outcome: 'success', details: 'OK' }]
                  }
                });
              }
            } else {
              cb({ success: true, data: {} });
            }
          }
        },
        storage: {
          local: { getBytesInUse: (keys, cb) => cb(0) }
        }
      };
    });

    await page.goto(dashboardUrl);
    await page.click('#navDiagnostics');

    // Handle dialog
    page.on('dialog', async (dialog) => {
      assert.ok(dialog.message().includes('clear'));
      await dialog.accept();
    });

    // Click clear button
    await page.click('#clearDiagnosticsBtn');

    // Wait for save indicator or updated UI
    await page.waitForSelector('#saveIndicator.show', { timeout: 3000 });
    const indicatorText = await page.textContent('#saveIndicator');
    assert.ok(indicatorText.includes('Diagnostics cleared'));

    const wasDispatched = await page.evaluate(() => window.__clearDispatched);
    assert.equal(wasDispatched, true);

    await page.close();
  });

  await t.test('4. Graceful handling of missing or corrupted diagnostic data', async () => {
    const page = await browser.newPage();

    // Mock response with corrupted / null payload
    await page.addInitScript(() => {
      window.chrome = {
        runtime: {
          sendMessage: (msg, cb) => {
            if (msg.type === 'GET_DIAGNOSTICS') {
              cb({ success: false, data: null });
            } else {
              cb({ success: true, data: {} });
            }
          }
        },
        storage: {
          local: { getBytesInUse: (keys, cb) => cb(0) }
        }
      };
    });

    await page.goto(dashboardUrl);
    await page.click('#navDiagnostics');

    // Ensure fallback is rendered without uncaught JavaScript exceptions
    const recoveryText = await page.textContent('#diagRecoveryRate');
    assert.equal(recoveryText.trim(), '—');

    const emptyStateVisible = await page.isVisible('#diagEmptyState');
    assert.equal(emptyStateVisible, true);

    await page.close();
  });

  await browser.close();
  await staticServer.close();
});
