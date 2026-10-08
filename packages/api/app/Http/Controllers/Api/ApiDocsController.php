<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\Api\OpenApiDocumentService;
use App\Services\Installer\InstallerWebBase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\File;

final class ApiDocsController
{
    public function __construct(private OpenApiDocumentService $openApiDocument) {}

    public function ui(Request $request): Response
    {
        $webBase = InstallerWebBase::detect();
        $specUrl = InstallerWebBase::url($webBase, '/api/openapi.json');
        $docsBase = InstallerWebBase::url($webBase, '/api/docs');
        $tokenUrl = InstallerWebBase::url($webBase, '/api/v1/auth/token');

        $html = $this->buildDocsHtml($specUrl, $docsBase, $tokenUrl);

        return response($html, 200, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    private function buildDocsHtml(string $specUrl, string $docsBase, string $tokenUrl): string
    {
        $specUrlJs = json_encode($specUrl, JSON_UNESCAPED_SLASHES);
        $tokenUrlJs = json_encode($tokenUrl, JSON_UNESCAPED_SLASHES);

        return <<<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WeGotWorkspace API Docs</title>
<link rel="icon" type="image/png" href="{$this->escapeHtml($docsBase.'/favicon-32x32.png')}">
<link rel="stylesheet" href="{$this->escapeHtml($docsBase.'/swagger-ui.css')}">
<style>
.wgw-docs-auth{max-width:1460px;margin:0 auto;padding:12px 20px;font-family:sans-serif;font-size:14px;border-bottom:1px solid #ddd;background:#fafafa}
.wgw-docs-auth form{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.wgw-docs-auth label{display:flex;align-items:center;gap:6px}
.wgw-docs-auth input{padding:6px 8px;border:1px solid #ccc;border-radius:4px}
.wgw-docs-auth button{padding:6px 14px;border:none;border-radius:4px;background:#4990e2;color:#fff;cursor:pointer}
.wgw-docs-auth button:disabled{opacity:.6;cursor:not-allowed}
.wgw-docs-auth-status{margin-left:4px}
.wgw-docs-auth-status--error{color:#c0392b}
.wgw-docs-auth-status--success{color:#2e7d32}
</style>
</head>
<body>
<div id="wgw-docs-auth" class="wgw-docs-auth">
<form id="wgw-docs-auth-form">
<label>Username <input type="text" id="wgw-docs-username" name="username" autocomplete="username" required></label>
<label>Password <input type="password" id="wgw-docs-password" name="password" autocomplete="current-password" required></label>
<button type="submit" id="wgw-docs-auth-submit">Get token</button>
<span id="wgw-docs-auth-status" class="wgw-docs-auth-status" role="status" aria-live="polite"></span>
</form>
</div>
<div id="swagger-ui"></div>
<script src="{$this->escapeHtml($docsBase.'/swagger-ui-bundle.js')}"></script>
<script src="{$this->escapeHtml($docsBase.'/swagger-ui-standalone-preset.js')}"></script>
<script>
(function () {
  var tokenUrl = {$tokenUrlJs};
  var statusEl = document.getElementById("wgw-docs-auth-status");
  var submitBtn = document.getElementById("wgw-docs-auth-submit");

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = "wgw-docs-auth-status" + (kind ? " wgw-docs-auth-status--" + kind : "");
  }

  window.ui = SwaggerUIBundle({
    url: {$specUrlJs},
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "BaseLayout",
    persistAuthorization: false
  });

  document.getElementById("wgw-docs-auth-form").addEventListener("submit", function (event) {
    event.preventDefault();
    setStatus("", "");
    var username = document.getElementById("wgw-docs-username").value.trim();
    var password = document.getElementById("wgw-docs-password").value;
    if (!username || !password) {
      setStatus("Enter username and password.", "error");
      return;
    }
    submitBtn.disabled = true;
    fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) {
            setStatus(data.error || data.message || ("Login failed (" + response.status + ")."), "error");
            return;
          }
          if (!data.access_token) {
            setStatus("Token response missing access_token.", "error");
            return;
          }
          window.ui.preauthorizeApiKey("bearerAuth", data.access_token);
          setStatus("Authorized" + (data.username ? " as " + data.username : "") + ".", "success");
        });
      })
      .catch(function () {
        setStatus("Network error: could not reach token endpoint.", "error");
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
</script>
</body>
</html>
HTML;
    }

    private function escapeHtml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function openApi(Request $request): JsonResponse
    {
        $webBase = InstallerWebBase::detect();

        return response()->json($this->openApiDocument->build($webBase));
    }

    public function asset(string $asset): JsonResponse|Response
    {
        $path = $this->resolveSwaggerAssetPath($asset);
        if (! is_readable($path)) {
            return response()->json([
                'error' => 'Swagger UI asset is missing.',
                'code' => 'docs_unavailable',
            ], 503);
        }

        return response(File::get($path), 200, [
            'Content-Type' => $this->contentTypeFor($asset),
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    private function contentTypeFor(string $asset): string
    {
        return match ($asset) {
            'swagger-ui.css' => 'text/css; charset=utf-8',
            'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js' => 'application/javascript; charset=utf-8',
            'favicon-32x32.png', 'favicon-16x16.png' => 'image/png',
            default => 'application/octet-stream',
        };
    }

    private function resolveSwaggerAssetPath(string $file): string
    {
        $candidates = [
            base_path('vendor/swagger-api/swagger-ui/dist/'.$file),
            dirname(__DIR__, 4).'/vendor/swagger-api/swagger-ui/dist/'.$file,
        ];
        foreach ($candidates as $candidate) {
            if (is_readable($candidate)) {
                return $candidate;
            }
        }

        return $candidates[0];
    }
}
