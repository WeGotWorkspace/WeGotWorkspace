<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;

/**
 * Guest upload helpers (#1715): an owner's public link on bob's folder, a
 * guest session from it, and the guest JMAP Session, API, and upload URL.
 * Use with {@see DriveTestFixtures}.
 */
trait InteractsWithGuestUploads
{
    protected const GUEST_SHARE_ROOT = '/users/bob/inbox';

    /** @var list<string> */
    protected const GUEST_USING = [
        JmapCapabilities::CORE,
        JmapCapabilities::FILENODE,
        JmapCapabilities::BLOB_ASSEMBLY,
        JmapCapabilities::FILENODE_VERSION_CHECK,
    ];

    /**
     * @return array{id: string, token: string}
     */
    protected function createGuestLink(string $access = 'edit', string $path = self::GUEST_SHARE_ROOT): array
    {
        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'public',
            'defaultAccess' => $access,
        ])->assertOk();

        return ['id' => (string) $response->json('data.id'), 'token' => (string) $response->json('data.publicToken')];
    }

    protected function openGuestSession(string $publicToken): string
    {
        return (string) $this->withHeaders([])->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertOk()
            ->json('access_token');
    }

    /**
     * @return array{accountId: string, uploadUrl: string, apiUrl: string}
     */
    protected function guestJmapSession(string $guestToken): array
    {
        $session = $this->withBearer($guestToken)->getJson('/api/v1/jmap/session')->assertOk();
        $accountId = (string) array_key_first((array) $session->json('accounts'));

        return [
            'accountId' => $accountId,
            'uploadUrl' => (string) $session->json('uploadUrl'),
            'apiUrl' => (string) $session->json('apiUrl'),
        ];
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     * @param  list<string>|null  $using
     */
    protected function guestJmap(string $guestToken, array $calls, ?array $using = null): TestResponse
    {
        return $this->withBearer($guestToken)->postJson('/api/v1/jmap/guest', [
            'using' => $using ?? self::GUEST_USING,
            'methodCalls' => $calls,
        ]);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    protected function guestMethod(string $guestToken, string $accountId, string $method, array $args): array
    {
        $response = $this->guestJmap($guestToken, [[$method, ['accountId' => $accountId] + $args, 'c']])->assertOk();

        return (array) $response->json('methodResponses.0.1') + ['_name' => $response->json('methodResponses.0.0')];
    }

    /**
     * @param  array<string, string>  $headers
     */
    protected function guestUpload(string $guestToken, string $accountId, string $bytes, array $headers = []): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/jmap/guest/upload/'.$accountId,
            server: $this->transformHeadersToServerVars($headers + [
                'Authorization' => 'Bearer '.$guestToken,
                'Content-Type' => 'application/octet-stream',
                'Content-Length' => (string) strlen($bytes),
            ]),
            content: $bytes,
        );
    }

    protected function guestRootNodeId(string $guestToken, string $accountId): string
    {
        $query = $this->guestMethod($guestToken, $accountId, 'FileNode/query', ['filter' => ['isTopLevel' => true]]);
        $this->assertCount(1, $query['ids'], json_encode($query) ?: '');

        return (string) $query['ids'][0];
    }

    /**
     * @return array<string, mixed>
     */
    protected function guestCreateFile(string $guestToken, string $accountId, string $parentId, string $name, string $blobId): array
    {
        return $this->guestMethod($guestToken, $accountId, 'FileNode/set', [
            'create' => ['f' => ['parentId' => $parentId, 'name' => $name, 'blobId' => $blobId]],
        ]);
    }
}
