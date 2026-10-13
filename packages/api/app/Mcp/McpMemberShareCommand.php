<?php

declare(strict_types=1);

namespace App\Mcp;

use App\Services\Drive\DriveShareService;

/**
 * Launch MCP may create, update, and revoke member shares only.
 * A public link or guest invite on the same path is left untouched.
 */
final class McpMemberShareCommand
{
    public function __construct(private DriveShareService $shares) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listForOwner(string $username, string $path): array
    {
        return array_map(
            $this->withoutPublicToken(...),
            $this->shares->listForOwner($username, $path),
        );
    }

    /**
     * @param  array{hasKind: bool, shareWithPresent: bool, shareWith: mixed, defaultAccess: string|null}  $request
     * @return array<string, mixed>
     */
    public function set(string $username, string $path, array $request): array
    {
        $hasKind = $request['hasKind'];
        $shareWithPresent = $request['shareWithPresent'];
        $shareWith = $request['shareWith'];
        $defaultAccess = $request['defaultAccess'];
        $members = $this->memberShares($this->shares->listForOwner($username, $path));

        if ($shareWithPresent && $shareWith === null) {
            foreach ($members as $share) {
                $this->shares->revokeShare($username, (string) $share['id']);
            }

            return ['ok' => true, 'revoked' => true];
        }

        $input = ['path' => $path, 'kind' => 'member'];
        if ($defaultAccess !== null) {
            $input['defaultAccess'] = $defaultAccess;
        }
        if ($shareWithPresent && is_array($shareWith)) {
            $input['shareWith'] = $shareWith;
        }

        if ($members === []) {
            if (! $shareWithPresent && ! $hasKind) {
                throw new \InvalidArgumentException('shareWith or kind is required to create a share.');
            }

            return $this->withoutPublicToken($this->shares->createShare($username, $input));
        }

        $share = $members[0];
        $input['updatedAt'] = $share['updatedAt'] ?? null;

        return $this->withoutPublicToken($this->shares->updateShare($username, (string) $share['id'], $input));
    }

    /**
     * @param  list<array<string, mixed>>  $shares
     * @return list<array<string, mixed>>
     */
    private function memberShares(array $shares): array
    {
        $members = [];
        foreach ($shares as $share) {
            if (($share['kind'] ?? null) === 'member') {
                $members[] = $share;
            }
        }

        return $members;
    }

    /**
     * @param  array<string, mixed>  $share
     * @return array<string, mixed>
     */
    private function withoutPublicToken(array $share): array
    {
        unset($share['publicToken']);

        return $share;
    }
}
