<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Request;

final class ApiUrlBuilder
{
    /** Host PHP / Docker HTTP bind used by `pnpm dev:api` — not the Vite SPA. */
    private const API_DEV_PORT = 9080;

    public function __construct(private Request $request) {}

    public function v1(string $path): string
    {
        $root = rtrim($this->request->getSchemeAndHttpHost().$this->request->getBaseUrl(), '/');

        return $root.'/api/v1/'.ltrim($path, '/');
    }

    public function logout(): string
    {
        return $this->appPath('logout');
    }

    public function appPath(string $path): string
    {
        $root = rtrim($this->publicAppOrigin().$this->appBasePath(), '/');

        return $root.'/'.ltrim($path, '/');
    }

    private function publicAppOrigin(): string
    {
        $configured = $this->httpOrigin((string) config('wgw.public_web_url', ''));
        if ($configured !== null) {
            return $configured;
        }

        if ($this->requestIsApiOnlyHost()) {
            $fromBrowser = $this->trustedBrowserOrigin();
            if ($fromBrowser !== null) {
                return $fromBrowser;
            }

            $vite = $this->viteDevOrigin();
            if ($vite !== null) {
                return $vite;
            }
        }

        return $this->request->getSchemeAndHttpHost();
    }

    private function appBasePath(): string
    {
        $dir = dirname($this->request->getBaseUrl());
        if ($dir === '/' || $dir === '\\' || $dir === '.' || $dir === '') {
            return '';
        }

        return $dir;
    }

    private function requestIsApiOnlyHost(): bool
    {
        return $this->isLoopbackHost($this->request->getHost())
            && (int) $this->request->getPort() === self::API_DEV_PORT;
    }

    private function trustedBrowserOrigin(): ?string
    {
        foreach (['Origin', 'Referer'] as $header) {
            $origin = $this->httpOrigin((string) $this->request->headers->get($header, ''));
            if ($origin === null) {
                continue;
            }
            $host = parse_url($origin, PHP_URL_HOST);
            if (is_string($host) && $this->isLoopbackHost($host)) {
                return $origin;
            }
        }

        return null;
    }

    private function viteDevOrigin(): ?string
    {
        $port = config('wgw.vite_dev_port');
        if (! is_numeric($port)) {
            return null;
        }
        $port = (int) $port;
        if ($port < 1 || $port > 65535) {
            return null;
        }

        return 'http://localhost:'.$port;
    }

    private function httpOrigin(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }
        $parts = parse_url($raw);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = $parts['host'] ?? null;
        if (! is_string($host) || $host === '' || ! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $origin = $scheme.'://'.$host;
        if (isset($parts['port'])) {
            $origin .= ':'.$parts['port'];
        }

        return $origin;
    }

    private function isLoopbackHost(string $host): bool
    {
        $host = strtolower($host);

        return $host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]' || $host === '::1';
    }
}
