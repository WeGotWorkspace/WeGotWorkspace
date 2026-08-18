<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;

/**
 * FileNode envelope helpers for Feature tests that retarget drive I/O off REST writes.
 */
trait InteractsWithFileNodeJmap
{
    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    protected function fileNodeJmap(array $methodCalls, ?string $token = null): TestResponse
    {
        return $this->withBearer($token ?? $this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    protected function uploadFileNodeBlob(
        string $contents,
        string $accountId = 'bob',
        ?string $token = null,
        string $type = 'text/plain',
    ): string {
        return (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/'.$accountId,
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.($token ?? $this->userBearerToken()),
                'Content-Type' => $type,
            ]),
            content: $contents,
        )->json('blobId');
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    protected function fileNodeGetAll(string $accountId = 'bob', ?string $token = null): array
    {
        $list = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ], $token)->assertOk()->json('methodResponses.0.1.list');

        $byId = [];
        foreach ($list as $node) {
            $byId[$node['id']] = $node;
        }

        return $byId;
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     */
    protected function fileNodeIdByName(array $nodes, string $name): string
    {
        foreach ($nodes as $node) {
            if ($node['name'] === $name) {
                return $node['id'];
            }
        }
        $this->fail('No FileNode named '.$name);
    }
}
