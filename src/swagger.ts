import type { Express, Request, Response } from 'express';
import { config } from './config';
import { buildOpenApiDocument } from './openapi/document';

/** Prefer the host the browser hit (works on Render even if BASE_URL is wrong). */
function requestPublicOrigin(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host');
  if (host) {
    return `${proto}://${host}`.replace(/\/$/, '');
  }
  return config.baseUrl.replace(/\/$/, '');
}

function renderApiExplorerHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Shopping Cart - API Explorer</title>
    <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
      }
      body {
        font-family: "Inter", sans-serif;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #1e293b;
        color: white;
        padding: 6px 6px;
        font-size: 12px;
      }
      .header-input-container {
        position: relative;
        width: 350px;
      }
      .header-input {
        width: 100%;
        padding: 10px 40px 10px 10px;
        font-size: 12px;
        border: 1px solid #3b475c;
        border-radius: 6px;
        background: #2d3a4d;
        color: white;
        outline: none;
        transition: 0.3s;
        box-sizing: border-box;
      }
      .header-input:focus {
        border-color: #58a6ff;
      }
      .copy-icon {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        cursor: pointer;
        width: 20px;
        height: 20px;
        fill: white;
        opacity: 0.7;
        transition: 0.3s;
      }
      .copy-icon:hover {
        opacity: 1;
        fill: #58a6ff;
      }
      .header-buttons {
        display: flex;
        gap: 10px;
      }
      .header-buttons button {
        background: #3b475c;
        color: white;
        border: none;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 14px;
        border-radius: 6px;
        transition: 0.3s;
      }
      .header-buttons button:hover {
        background: #58a6ff;
      }
      elements-api {
        display: block;
        height: calc(100vh - 48px);
      }
      @media (max-width: 768px) {
        .header-input-container, .header-buttons {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-input-container">
        <input type="text" id="origin-input" class="header-input" readonly>
        <svg id="copy-btn" class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm4 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h12v14z"/>
        </svg>
      </div>
      <div class="header-buttons">
        <button id="docs-home" type="button">API Docs</button>
      </div>
    </div>

    <elements-api id="api-explorer" router="hash" layout="sidebar"></elements-api>

    <script>
      document.addEventListener("DOMContentLoaded", function () {
        const apiExplorer = document.getElementById("api-explorer");
        const originInput = document.getElementById("origin-input");
        const copyBtn = document.getElementById("copy-btn");
        const docsHomeBtn = document.getElementById("docs-home");

        const apiDescriptionUrl = window.location.origin + "/api/openapi";
        apiExplorer.apiDescriptionUrl = apiDescriptionUrl;
        originInput.value = apiDescriptionUrl;

        copyBtn.addEventListener("click", function () {
          navigator.clipboard.writeText(originInput.value).then(function () {
            copyBtn.style.fill = "#58a6ff";
            setTimeout(function () {
              copyBtn.style.fill = "white";
            }, 1500);
          });
        });

        docsHomeBtn.addEventListener("click", function () {
          window.location.href = window.location.origin + "/api-docs";
        });
      });
    </script>
  </body>
</html>`;
}

export function mountSwagger(app: Express): void {
  const document = buildOpenApiDocument();
  const html = renderApiExplorerHtml();

  const sendOpenApi = (req: Request, res: Response) => {
    const origin = requestPublicOrigin(req);
    const servers = [
      { url: origin, description: 'This deployment' },
      {
        url: 'http://localhost:3002',
        description: 'Local development',
      },
    ];
    // Avoid duplicating identical URLs when BASE_URL already matches origin
    const unique = servers.filter(
      (s, i, arr) => arr.findIndex((x) => x.url === s.url) === i,
    );
    res.type('application/json').send({ ...document, servers: unique });
  };

  app.get('/api/openapi', sendOpenApi);
  app.get('/openapi.json', sendOpenApi);

  app.get(['/api-docs', '/api-docs/'], (_req, res) => {
    res.type('html').send(html);
  });
}
