<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Exceptions\ApiHttpException;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Mail\MailResponseException;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Support\Facades\Auth;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

abstract class WgwMcpTool extends Tool
{
    public const TEXT_MAX_BYTES = 65536;

    public function __construct(
        protected McpAuditLogger $audit,
        protected AdminRoleResolver $adminRoles,
    ) {}

    abstract protected function requiredScope(): ?string;

    abstract protected function accessMode(): string;

    /**
     * @return array<string, mixed>|string|null
     */
    abstract protected function target(Request $request): array|string|null;

    abstract protected function run(Request $request): Response;

    final public function handle(Request $request): Response
    {
        if ($this->isHardRefused()) {
            $this->record('denied', $request);

            return Response::error('This operation is not available through MCP.');
        }

        $scope = $this->requiredScope();
        $user = $this->user();
        if ($scope !== null && ! McpScopes::tokenAllows($user, $scope)) {
            $this->record('denied', $request);

            return Response::error('Missing OAuth scope: '.$scope);
        }

        try {
            $response = $this->run($request);
            $this->record('ok', $request);

            return $response;
        } catch (ApiHttpException $e) {
            $this->record('error', $request);

            return Response::error($e->getMessage());
        } catch (MailResponseException $e) {
            $this->record('error', $request);
            $msg = is_array($e->payload) ? (string) ($e->payload['error'] ?? $e->getMessage()) : $e->getMessage();

            return Response::error($msg !== '' ? $msg : 'Mail operation failed.');
        } catch (\InvalidArgumentException $e) {
            $this->record('error', $request);

            return Response::error($e->getMessage());
        } catch (\RuntimeException $e) {
            $this->record('error', $request);

            return Response::error($e->getMessage());
        }
    }

    protected function user(): User
    {
        $user = Auth::guard('api')->user();
        if (! $user instanceof User) {
            throw new ApiHttpException(401, 'Unauthenticated.', 'unauthorized');
        }

        return $user;
    }

    /**
     * @return array{username: string, role: string}
     */
    protected function principal(): array
    {
        $username = (string) $this->user()->username;

        return [
            'username' => $username,
            'role' => $this->adminRoles->isAdmin($username) ? 'admin' : 'user',
        ];
    }

    protected function isHardRefused(): bool
    {
        $name = strtolower($this->name());

        return str_contains($name, 'admin')
            || str_contains($name, 'installer')
            || str_contains($name, 'jmap-batch')
            || str_contains($name, 'vault')
            || str_contains($name, 'plaintext');
    }

    protected function record(string $outcome, Request $request): void
    {
        $this->audit->toolCall($this->name(), $this->accessMode(), $outcome, $this->target($request));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function json(array $payload): Response
    {
        return Response::json($payload);
    }

    protected function writeAction(Request $request): string
    {
        $action = strtolower(trim((string) $request->get('action', '')));
        if (! in_array($action, ['create', 'update', 'delete'], true)) {
            throw new \InvalidArgumentException('action must be create, update, or delete.');
        }

        return $action;
    }

    protected function shareAction(Request $request): string
    {
        $action = strtolower(trim((string) $request->get('action', '')));
        if (! in_array($action, ['get', 'set'], true)) {
            throw new \InvalidArgumentException('action must be get or set.');
        }

        return $action;
    }

    protected function assertTextWithinCap(?string $text, string $field = 'text'): void
    {
        if ($text === null || $text === '') {
            return;
        }
        if (strlen($text) > self::TEXT_MAX_BYTES) {
            throw new \InvalidArgumentException($field.' is too large for MCP.');
        }
    }

    protected function tokenAllows(string $scope): bool
    {
        return McpScopes::tokenAllows($this->user(), $scope);
    }

    protected function assertMarkdownPath(string $path): void
    {
        if (! str_ends_with(strtolower($path), '.md')) {
            throw new \InvalidArgumentException('path must be a Markdown (.md) Docs file.');
        }
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    protected function pick(array $row, array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            if (array_key_exists($key, $row)) {
                $out[$key] = $row[$key];
            }
        }

        return $out;
    }
}
