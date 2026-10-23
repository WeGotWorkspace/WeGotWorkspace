<?php

declare(strict_types=1);

namespace App\Services\Ui;

use App\Services\Installer\InstallerWebBase;
use App\Support\AppPaths;
use App\Ui\UiStaticServer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class UiStaticFront
{
    public function __construct(
        private AppPaths $paths,
        private UiStaticServer $static,
    ) {}

    public function handle(Request $request): ?Response
    {
        $method = strtoupper($request->method());
        if ($method !== 'GET' && $method !== 'HEAD') {
            return null;
        }

        // Sabre Browser plugin serves HTML/CSS at ?sabreAction=… on the DAV base URI (often "/").
        if ($request->query->has('sabreAction')) {
            return null;
        }

        $path = $request->getPathInfo() ?: '/';
        $webBase = InstallerWebBase::detect();

        if ($this->static->matchesInstallPath($webBase, $path)) {
            return $this->handleInstall($webBase, $path, $method);
        }

        if (! $this->paths->isInstalled()) {
            if ($this->isPublicAssetPath($webBase, $path)) {
                foreach (['install', 'shell'] as $module) {
                    $dist = $this->paths->moduleDistRoot($module);
                    if ($dist === null) {
                        continue;
                    }
                    $asset = $this->static->tryServe($dist, $webBase, $path, false);
                    if ($asset !== null) {
                        return $asset;
                    }
                }
            }

            return InstallerWebBase::redirectToInstallWizard();
        }

        // Temporary. A 301 would stick in browsers after the Mail client returns in v1.0.
        if ($this->isUnshippedMailClientPath($webBase, $path)) {
            return redirect(InstallerWebBase::url($webBase, '/'), 302)->setContent('');
        }

        // 302, not 301: a permanent redirect would stick in browsers if /apps is reused.
        if ($this->isRemovedPluginAppPath($webBase, $path)) {
            return redirect(InstallerWebBase::url($webBase, '/'), 302)->setContent('');
        }

        if ($this->static->matchesShellPath($webBase, $path)) {
            return $this->handleShell($webBase, $path, $method);
        }

        return null;
    }

    private function handleInstall(string $webBase, string $path, string $method): Response
    {
        $installPrefix = InstallerWebBase::url($webBase, '/install');
        if ($path === $installPrefix) {
            // Serve the wizard directly; a 301 to "/install/" is normalized back to "/install" by Apache.
            $path = $installPrefix.'/';
        }

        if ($this->paths->isInstalled()) {
            if ($method === 'HEAD') {
                return response('', 200);
            }

            return $this->alreadyInstalled($webBase);
        }

        $dist = $this->paths->moduleDistRoot('install');
        if ($dist === null) {
            return $this->distMissing('install');
        }

        $served = $this->static->tryServe($dist, $webBase, $path, true);

        return $served ?? $this->notFound();
    }

    private function handleShell(string $webBase, string $path, string $method): Response
    {
        $dist = $this->paths->shellDistRoot();
        if ($dist === null) {
            return $this->distMissing('shell');
        }

        if ($method === 'HEAD') {
            return response('', 200);
        }

        $served = $this->static->tryServe($dist, $webBase, $path, true);

        return $served ?? $this->notFound();
    }

    /**
     * Installable plugins were removed, but bookmarks and an installed plugin PWA
     * still request `/apps`. That prefix is not a shell route, and the shell service
     * worker does not claim it, so without this redirect the request falls through
     * to SabreDAV.
     */
    private function isRemovedPluginAppPath(string $webBase, string $path): bool
    {
        $prefix = InstallerWebBase::url($webBase, '/apps');

        return $path === $prefix || $path === $prefix.'/' || str_starts_with($path, $prefix.'/');
    }

    /**
     * Bookmarks and an installed Mail PWA still request `/mail`. That prefix is
     * not a shell route, so without this redirect the request falls through to SabreDAV.
     */
    private function isUnshippedMailClientPath(string $webBase, string $path): bool
    {
        $prefix = InstallerWebBase::url($webBase, '/mail');

        return $path === $prefix || $path === $prefix.'/' || str_starts_with($path, $prefix.'/');
    }

    private function isPublicAssetPath(string $webBase, string $path): bool
    {
        foreach ([...UiStaticServer::globalAssetPrefixes(), '/index.html', '/sw.js'] as $prefix) {
            $full = InstallerWebBase::url($webBase, $prefix);
            if ($path === $full || str_starts_with($path, $full.'/')) {
                return true;
            }
        }

        $workboxPrefix = InstallerWebBase::url($webBase, '/workbox-');
        if (str_starts_with($path, $workboxPrefix) && str_ends_with($path, '.js')) {
            return true;
        }

        return false;
    }

    private function alreadyInstalled(string $webBase): Response
    {
        $login = InstallerWebBase::url($webBase, '/login');

        return redirect($login, 302)->setContent('');
    }

    private function distMissing(string $module): Response
    {
        $html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>WeGotWorkspace</title></head><body>';
        $html .= '<h1>UI build missing</h1>';
        $html .= '<p>Run <code>pnpm --filter @wgw/apps build</code> to generate <code>'.$module.'/dist</code>.</p>';
        $html .= '</body></html>';

        return response($html, 503, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    private function notFound(): Response
    {
        return response('Not found', 404, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}
