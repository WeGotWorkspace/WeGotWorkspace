<?php

declare(strict_types=1);

namespace App\Services\Update;

final class ReleaseFeedClient
{
    /**
     * @return array<string, mixed>|null
     */
    public function fetchLatest(string $feedUrl): ?array
    {
        $feedUrl = trim($feedUrl);
        if ($feedUrl === '') {
            return null;
        }
        $raw = $this->fetchJsonText($feedUrl);
        if ($raw === null) {
            $apiFallback = $this->githubApiUrlFromFeedUrl($feedUrl);
            if ($apiFallback !== null) {
                $raw = $this->fetchJsonText($apiFallback);
                if ($raw !== null) {
                    $feedUrl = $apiFallback;
                }
            }
        }
        if ($raw === null) {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            $apiFallback = $this->githubApiUrlFromFeedUrl($feedUrl);
            if ($apiFallback !== null && $apiFallback !== $feedUrl) {
                $raw = $this->fetchJsonText($apiFallback);
                if ($raw !== null) {
                    $decoded = json_decode($raw, true);
                    if (is_array($decoded)) {
                        $feedUrl = $apiFallback;
                    }
                }
            }
        }
        if (! is_array($decoded)) {
            return null;
        }

        if (isset($decoded['version']) && is_string($decoded['version'])) {
            return $this->normalizeManifestMetadata($decoded, $feedUrl);
        }

        if (isset($decoded['tag_name']) && is_string($decoded['tag_name']) && isset($decoded['assets']) && is_array($decoded['assets'])) {
            $manifestAssetUrl = null;
            $zipAssetUrl = null;
            foreach ($decoded['assets'] as $asset) {
                if (! is_array($asset)) {
                    continue;
                }
                $name = isset($asset['name']) && is_string($asset['name']) ? $asset['name'] : '';
                $assetUrl = isset($asset['browser_download_url']) && is_string($asset['browser_download_url'])
                    ? $asset['browser_download_url']
                    : null;
                if ($assetUrl === null) {
                    continue;
                }
                if ($name === 'manifest.json') {
                    $manifestAssetUrl = $assetUrl;
                }
                if (str_ends_with($name, '.zip') && str_contains($name, 'wegotworkspace-deploy-')) {
                    $zipAssetUrl = $assetUrl;
                }
            }
            if ($manifestAssetUrl === null) {
                return null;
            }
            $manifestRaw = $this->fetchJsonText($manifestAssetUrl);
            if ($manifestRaw === null) {
                return null;
            }
            $manifest = json_decode($manifestRaw, true);
            if (! is_array($manifest)) {
                return null;
            }
            if ((! isset($manifest['package_url']) || ! is_string($manifest['package_url']) || trim($manifest['package_url']) === '') && $zipAssetUrl !== null) {
                $manifest['package_url'] = $zipAssetUrl;
            }
            if ((! isset($manifest['notes_url']) || ! is_string($manifest['notes_url']) || trim($manifest['notes_url']) === '') && isset($decoded['html_url']) && is_string($decoded['html_url'])) {
                $manifest['notes_url'] = $decoded['html_url'];
            }

            return $this->normalizeManifestMetadata($manifest, $manifestAssetUrl);
        }

        return null;
    }

    private function fetchJsonText(string $url): ?string
    {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 20,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\nUser-Agent: WeGotWorkspace-Updater/1.0\r\n",
            ],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        return $raw;
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function normalizeManifestMetadata(array $manifest, string $manifestUrl): array
    {
        $version = isset($manifest['version']) && is_string($manifest['version']) ? trim($manifest['version']) : '';
        if ($version === '') {
            return $manifest;
        }
        $versionNoV = str_starts_with($version, 'v') ? substr($version, 1) : $version;

        $packageUrl = isset($manifest['package_url']) && is_string($manifest['package_url'])
            ? trim($manifest['package_url'])
            : '';
        if ($packageUrl === '' && str_ends_with($manifestUrl, '/manifest.json')) {
            $base = substr($manifestUrl, 0, -strlen('/manifest.json'));
            $manifest['package_url'] = $base.'/wegotworkspace-deploy-'.$versionNoV.'.zip';
        }

        $notesUrl = isset($manifest['notes_url']) && is_string($manifest['notes_url'])
            ? trim($manifest['notes_url'])
            : '';
        if ($notesUrl === '' && preg_match('#^https://github\.com/([^/]+)/([^/]+)/releases/(?:download/[^/]+|latest/download)/manifest\.json$#', $manifestUrl, $m) === 1) {
            $owner = $m[1];
            $repo = $m[2];
            $manifest['notes_url'] = 'https://github.com/'.$owner.'/'.$repo.'/releases/tag/v'.$versionNoV;
        }

        return $manifest;
    }

    private function githubApiUrlFromFeedUrl(string $url): ?string
    {
        $parts = parse_url($url);
        if (! is_array($parts)) {
            return null;
        }
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($host !== 'github.com' && $host !== 'www.github.com') {
            return null;
        }
        $path = trim((string) ($parts['path'] ?? ''), '/');
        if ($path === '') {
            return null;
        }
        $segments = array_values(array_filter(explode('/', $path), static fn (string $v): bool => $v !== ''));
        if (count($segments) < 4) {
            return null;
        }
        [$owner, $repo, $section, $sub] = array_slice($segments, 0, 4);
        if ($section !== 'releases') {
            return null;
        }
        $api = 'https://api.github.com/repos/'.$owner.'/'.$repo.'/releases/';
        if ($sub === 'latest') {
            return $api.'latest';
        }
        // releases/download/<tag>/manifest.json is one release (a channel
        // feed or a pinned version), never "latest": falling back to latest
        // would move a beta or edge install onto the stable feed.
        $tag = $segments[4] ?? '';
        if ($sub === 'download' && $tag !== '' && preg_match('/^[A-Za-z0-9._-]+$/', $tag) === 1) {
            return $api.'tags/'.rawurlencode($tag);
        }

        return null;
    }
}
