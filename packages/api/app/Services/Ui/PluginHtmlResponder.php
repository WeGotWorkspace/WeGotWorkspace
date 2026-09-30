<?php

declare(strict_types=1);

namespace App\Services\Ui;

use App\Dav\Auth\SabreUiAuthGate;
use App\Services\Auth\UiSessionService;
use App\Services\Installer\InstallerWebBase;
use App\Support\WgwSettings;
use Symfony\Component\HttpFoundation\Response;

final class PluginHtmlResponder
{
    public function __construct(
        private UiSessionService $uiSession,
    ) {}

    /**
     * @param  array{
     *   plugin: array<string, mixed>,
     *   routePrefix: string,
     *   indexPath: string|null,
     *   buildRoot: string|null
     * }  $match
     */
    public function isInjectedHtmlPath(string $webBase, string $path, array $match): bool
    {
        return $this->resolveHtmlFile($webBase, $path, $match) !== null;
    }

    /**
     * @param  array{
     *   plugin: array<string, mixed>,
     *   routePrefix: string,
     *   indexPath: string|null,
     *   buildRoot: string|null
     * }  $match
     */
    public function tryRespond(string $webBase, string $path, array $match): ?Response
    {
        $distFile = $this->resolveHtmlFile($webBase, $path, $match);
        if ($distFile === null) {
            return null;
        }

        $cfg = WgwSettings::normalized();
        if (! ($cfg[WgwSettings::FILES_ENABLED] ?? true)) {
            return response('WebDAV files are disabled for this site.', 404, [
                'Content-Type' => 'text/plain; charset=utf-8',
            ]);
        }

        $realm = (string) ($cfg[WgwSettings::AUTH_REALM] ?? 'SabreDAV');
        $username = SabreUiAuthGate::validatedUsername($realm);
        if ($username === null) {
            $return = rawurlencode($path);
            $login = InstallerWebBase::url($webBase, '/login?return='.$return);

            return redirect($login);
        }

        if (! is_readable($distFile)) {
            $pluginId = (string) ($match['plugin']['id'] ?? 'plugin');

            return response(
                '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Plugin unavailable</title></head><body>'
                .'<h1>Plugin UI is not built</h1>'
                .'<p>Install the <strong>'.htmlspecialchars($pluginId, ENT_QUOTES, 'UTF-8').'</strong> plugin from '
                .'<strong>Admin → Plugins</strong> '
                .'(see <a href="https://github.com/WeGotWorkspace/plugins/releases">WeGotWorkspace/plugins</a> releases), then reload.</p>'
                .'</body></html>',
                503,
                ['Content-Type' => 'text/html; charset=utf-8']
            );
        }

        $html = (string) file_get_contents($distFile);
        $plugin = $match['plugin'];
        $integration = is_array($plugin['integration'] ?? null) ? $plugin['integration'] : [];
        $configGlobal = isset($integration['configGlobal']) && is_string($integration['configGlobal'])
            ? trim($integration['configGlobal'])
            : '__WGW_PLUGIN_CONFIG__';
        if ($configGlobal === '') {
            $configGlobal = '__WGW_PLUGIN_CONFIG__';
        }

        $route = isset($plugin['appTile']['route']) && is_string($plugin['appTile']['route'])
            ? trim($plugin['appTile']['route'])
            : '/';
        $pluginRoute = InstallerWebBase::url($webBase, rtrim($route, '/').'/');

        $payload = [
            'base_uri' => (string) ($cfg[WgwSettings::BASE_URI] ?? '/'),
            'auth_realm' => $realm,
            'timezone' => (string) ($cfg[WgwSettings::TIMEZONE] ?? 'UTC'),
            'plugin_id' => (string) ($plugin['id'] ?? ''),
            'plugin_route' => $pluginRoute,
            'username' => $username,
        ];
        foreach (['sessionApiPath', 'saveTransport', 'editorPaths'] as $key) {
            if (array_key_exists($key, $integration)) {
                $payload[$key] = $integration[$key];
            }
        }

        $json = json_encode(
            $payload,
            JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES
        );
        $inject = '<script>window.'.$configGlobal.'='.$json.';</script>';

        if (preg_match('#<head[^>]*>#i', $html, $m, PREG_OFFSET_CAPTURE)) {
            $tag = $m[0][0];
            $pos = $m[0][1] + strlen($tag);
            $html = substr($html, 0, $pos)."\n".$inject.substr($html, $pos);
        } elseif (str_contains($html, '</head>')) {
            $html = str_replace('</head>', $inject."\n</head>", $html);
        } else {
            $html = $inject."\n".$html;
        }

        $cookie = $this->uiSession->buildCookie($username, $realm, InstallerWebBase::url($webBase, '/'));

        return response($html, 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ])->withCookie($cookie);
    }

    /**
     * @param  array{
     *   plugin: array<string, mixed>,
     *   routePrefix: string,
     *   indexPath: string|null,
     *   buildRoot: string|null
     * }  $match
     */
    private function resolveHtmlFile(string $webBase, string $path, array $match): ?string
    {
        $indexPath = $match['indexPath'] ?? null;
        if ($indexPath === null) {
            return null;
        }

        $root = dirname($indexPath);
        $plugin = $match['plugin'];
        $route = isset($plugin['appTile']['route']) && is_string($plugin['appTile']['route'])
            ? trim($plugin['appTile']['route'])
            : '';
        if ($route === '') {
            return null;
        }

        $home = InstallerWebBase::url($webBase, $route);
        if ($path === $home || $path === $home.'/' || $path === $home.'/index.html') {
            return $indexPath;
        }

        $integration = is_array($plugin['integration'] ?? null) ? $plugin['integration'] : [];
        $editorPaths = isset($integration['editorPaths']) && is_array($integration['editorPaths'])
            ? $integration['editorPaths']
            : ['editor', 'editor.html'];

        foreach ($editorPaths as $editorPath) {
            if (! is_string($editorPath) || trim($editorPath) === '') {
                continue;
            }
            $editorPath = trim($editorPath);
            $editorUrl = str_starts_with($editorPath, '/')
                ? InstallerWebBase::url($webBase, $editorPath)
                : InstallerWebBase::url($webBase, rtrim($route, '/').'/'.$editorPath);
            if ($path === $editorUrl || $path === $editorUrl.'/' || $path === $editorUrl.'.html') {
                if (str_ends_with($editorPath, '.html')) {
                    $flat = $root.'/'.basename($editorPath);
                    if (is_readable($flat)) {
                        return $flat;
                    }
                }
                $flat = $root.'/'.basename($editorPath).'.html';
                if (is_readable($flat)) {
                    return $flat;
                }

                return $root.'/'.trim($editorPath, '/').'/index.html';
            }
        }

        return null;
    }
}
