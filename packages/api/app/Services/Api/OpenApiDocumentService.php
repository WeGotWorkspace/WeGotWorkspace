<?php

declare(strict_types=1);

namespace App\Services\Api;

use App\Services\Installer\InstallerWebBase;
use Illuminate\Support\Facades\File;

final class OpenApiDocumentService
{
    /**
     * @return array<string, mixed>
     */
    public function build(string $webBase): array
    {
        $path = base_path('openapi/openapi.json');
        if (! is_readable($path)) {
            throw new \RuntimeException('OpenAPI spec file is missing.');
        }

        $raw = File::get($path);

        $spec = json_decode($raw, true);
        if (! is_array($spec)) {
            throw new \RuntimeException('OpenAPI spec is invalid JSON.');
        }

        $serverUrl = InstallerWebBase::url($webBase, '/api/v1');

        return $this->withServerUrl($spec, $serverUrl);
    }

    /**
     * @param  array<string, mixed>  $spec
     * @return array<string, mixed>
     */
    private function withServerUrl(array $spec, string $serverUrl): array
    {
        if (! isset($spec['servers']) || ! is_array($spec['servers']) || $spec['servers'] === []) {
            $spec['servers'] = [['url' => $serverUrl]];

            return $spec;
        }

        $servers = [];
        foreach ($spec['servers'] as $server) {
            if (! is_array($server)) {
                continue;
            }
            $url = (string) ($server['url'] ?? '');
            if ($url === '__SERVER_URL__' || $url === '/api/v1' || $url === '') {
                $server['url'] = $serverUrl;
            }
            $servers[] = $server;
        }
        $spec['servers'] = $servers !== [] ? $servers : [['url' => $serverUrl]];

        return $spec;
    }
}
