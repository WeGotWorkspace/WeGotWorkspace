<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Support\Facades\Route;

/**
 * Helpers for OpenAPI ↔ Laravel route parity (api-done-gate).
 */
final class OpenApiContract
{
    /** @return array<string, mixed> */
    public static function loadSpec(): array
    {
        $specPath = dirname(__DIR__, 2).'/openapi/openapi.json';
        if (! is_readable($specPath)) {
            throw new \RuntimeException('Missing openapi/openapi.json');
        }
        $spec = json_decode((string) file_get_contents($specPath), true);
        if (! is_array($spec)) {
            throw new \RuntimeException('Invalid openapi/openapi.json');
        }

        return $spec;
    }

    /**
     * @return array<string, mixed>
     */
    public static function paths(): array
    {
        $spec = self::loadSpec();
        $paths = $spec['paths'] ?? [];

        return is_array($paths) ? $paths : [];
    }

    /**
     * @return list<string> keys like "GET /health"
     */
    public static function registeredApiOperations(): array
    {
        $operations = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/v1/')) {
                continue;
            }
            $relative = substr($uri, strlen('api/v1'));
            $openApiPath = str_starts_with($relative, '/') ? $relative : '/'.$relative;

            foreach ($route->methods() as $method) {
                if (in_array($method, ['HEAD', 'OPTIONS'], true)) {
                    continue;
                }
                $operations[] = strtoupper($method).' '.$openApiPath;
            }
        }

        sort($operations);

        return $operations;
    }

    /**
     * @return list<string> keys like "GET /health"
     */
    public static function documentedApiOperations(): array
    {
        $operations = [];
        foreach (self::paths() as $path => $pathItem) {
            if (! is_string($path) || ! is_array($pathItem)) {
                continue;
            }
            foreach ($pathItem as $op => $definition) {
                if (! is_string($op) || ! is_array($definition)) {
                    continue;
                }
                if (in_array(strtolower($op), ['parameters', 'summary', 'description', 'servers'], true)) {
                    continue;
                }
                $operations[] = strtoupper($op).' '.$path;
            }
        }

        sort($operations);

        return $operations;
    }

    /**
     * @return list<array{method: string, path: string, access: string}>
     */
    public static function operationsWithAccess(): array
    {
        $operations = [];
        foreach (self::paths() as $path => $pathItem) {
            if (! is_string($path) || ! is_array($pathItem)) {
                continue;
            }
            foreach ($pathItem as $op => $definition) {
                if (! is_string($op) || ! is_array($definition)) {
                    continue;
                }
                if (in_array(strtolower($op), ['parameters', 'summary', 'description', 'servers'], true)) {
                    continue;
                }
                $access = $definition['x-wgw-access'] ?? null;
                if (! is_string($access) || $access === '') {
                    continue;
                }
                $operations[] = [
                    'method' => strtoupper($op),
                    'path' => $path,
                    'access' => $access,
                ];
            }
        }

        usort($operations, static fn (array $a, array $b): int => [$a['path'], $a['method']] <=> [$b['path'], $b['method']]);

        return $operations;
    }

    /**
     * @return list<array{method: string, path: string, responses: array<string, mixed>}>
     */
    public static function jmapRestOperations(): array
    {
        $prefixes = ['/contacts/', '/calendars/', '/tasks/'];
        $operations = [];

        foreach (self::paths() as $path => $pathItem) {
            if (! is_string($path) || ! is_array($pathItem)) {
                continue;
            }
            $matched = false;
            foreach ($prefixes as $prefix) {
                if (str_starts_with($path, $prefix)) {
                    $matched = true;
                    break;
                }
            }
            if (! $matched) {
                continue;
            }
            foreach ($pathItem as $op => $definition) {
                if (! is_string($op) || ! is_array($definition)) {
                    continue;
                }
                if (in_array(strtolower($op), ['parameters', 'summary', 'description', 'servers'], true)) {
                    continue;
                }
                $responses = $definition['responses'] ?? null;
                if (! is_array($responses)) {
                    continue;
                }
                $operations[] = [
                    'method' => strtoupper($op),
                    'path' => $path,
                    'responses' => $responses,
                ];
            }
        }

        usort($operations, static fn (array $a, array $b): int => [$a['path'], $a['method']] <=> [$b['path'], $b['method']]);

        return $operations;
    }

    /**
     * Replace OpenAPI path placeholders with stable sample values for smoke requests.
     */
    public static function sampleRequestPath(string $openApiPath): string
    {
        $replacements = [
            '{roomId}' => 'daily-room',
            '{messageId}' => 'INBOX:1',
            '{username}' => 'bob',
            '{group}' => 'testgroup',
            '{participantId}' => 'peer-alpha',
            '{id}' => 'demo-plugin',
            '{name}' => 'backup.zip',
            '{jobId}' => 'current',
            '{resultId}' => '1',
            '{attachmentId}' => '1.1',
            '{addressBookId}' => 'default',
            '{cardId}' => 'demo-card',
            '{blobId}' => '550e8400e29b41d4a716446655440000',
            '{calendarId}' => 'default',
            '{eventId}' => 'demo-event',
            '{taskListId}' => 'tasks-inbox',
            '{taskId}' => 'demo-task',
            '{notebookId}' => 'notes-general',
            '{noteId}' => 'demo-note',
            '{shareId}' => '550e8400-e29b-41d4-a716-446655440001',
            '{inviteId}' => '550e8400-e29b-41d4-a716-446655440002',
            '{notificationId}' => 'missing-notification.ics',
            '{token}' => 'missingrsvptoken',
        ];

        $path = $openApiPath;
        foreach ($replacements as $placeholder => $sample) {
            $path = str_replace($placeholder, $sample, $path);
        }
        if (str_starts_with($openApiPath, '/auth/password-resets/')) {
            $path = str_replace(
                '{token}',
                '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                $openApiPath,
            );
        }

        return $path;
    }

    public static function sampleQueryString(string $openApiPath, string $method): string
    {
        if (str_starts_with($openApiPath, '/files')) {
            if ($openApiPath === '/files/shares/at-path') {
                return 'path='.rawurlencode('/groups/team');
            }
            if ($openApiPath === '/files/shares/public/revoke-all') {
                return 'path='.rawurlencode('/groups/team');
            }
            if ($openApiPath === '/files/shares/by-principal') {
                return 'principal=alice';
            }

            return 'path='.rawurlencode('/users/bob');
        }
        if ($openApiPath === '/files' && $method === 'GET') {
            return 'search='.rawurlencode('test');
        }
        if (str_starts_with($openApiPath, '/mail/messages') && $method === 'GET' && ! str_contains($openApiPath, '{')) {
            return 'folder='.rawurlencode('INBOX').'&limit=1';
        }
        if ($openApiPath === '/rooms/{roomId}/events' && $method === 'GET') {
            return 'peerId=peer-alpha';
        }
        if ($openApiPath === '/contacts/cards/import' && $method === 'POST') {
            return 'addressBookId=default';
        }
        if ($openApiPath === '/calendars/events/import' && $method === 'POST') {
            return 'calendarId=default';
        }
        if ($openApiPath === '/calendars/events' && $method === 'GET') {
            return 'calendarId=default';
        }
        if ($openApiPath === '/calendars/calendars/changes' && $method === 'GET') {
            return 'since=0';
        }
        if ($openApiPath === '/tasks/items' && $method === 'GET') {
            return 'taskListId=inbox';
        }
        if ($openApiPath === '/tasks/tasklists/changes' && $method === 'GET') {
            return 'since=0';
        }
        if ($openApiPath === '/tasks/items/query' && $method === 'POST') {
            return '';
        }

        return '';
    }
}
