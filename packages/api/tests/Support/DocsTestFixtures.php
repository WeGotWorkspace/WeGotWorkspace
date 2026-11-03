<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;

/**
 * Shared Docs workspace fixtures: seeding, JMAP saves, and GET content helpers.
 */
trait DocsTestFixtures
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;

    protected function setUpDocsFixtures(): void
    {
        $this->setUpDriveFixtures();
    }

    protected function tearDownDocsFixtures(): void
    {
        $this->tearDownDriveFixtures();
    }

    protected function seedDocFile(string $username, string $filename, string $content): string
    {
        app(WgwStorage::class)->files()->put('users/'.$username.'/docs/'.$filename, $content);

        return '/users/'.$username.'/docs/'.$filename;
    }

    /**
     * Saves a doc the way the apps do: JMAP blob upload, then FileNode/set
     * create (new file) or update (existing file). Missing folders under the
     * user's home are created first. Returns the file node id.
     */
    protected function storeDoc(
        string $username,
        string $parentPath,
        string $filename,
        string $content,
    ): string {
        $token = $this->issueBearerTokenFor($username);
        $nodes = $this->fileNodeGetAll($username, $token);
        $parentId = $this->ensureHomeFolderNode($username, $token, $nodes, $parentPath);
        $blobId = $this->uploadFileNodeBlob($content, $username, $token);
        $existingId = $this->childFileNodeId($nodes, $parentId, $filename);

        if ($existingId !== null) {
            $updated = $this->fileNodeJmap([
                ['FileNode/set', ['accountId' => $username, 'update' => [
                    $existingId => ['blobId' => $blobId],
                ]], 'c0'],
            ], $token)->assertOk()->json('methodResponses.0.1.updated');
            $this->assertIsArray($updated);
            $this->assertArrayHasKey($existingId, $updated, 'FileNode/set did not update '.$parentPath.'/'.$filename);

            return $existingId;
        }

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => $username, 'create' => [
                'f0' => ['parentId' => $parentId, 'name' => $filename, 'blobId' => $blobId],
            ]], 'c0'],
        ], $token)->assertOk();
        $id = $created->json('methodResponses.0.1.created.f0.id');
        $this->assertIsString($id, 'FileNode/set did not create '.$parentPath.'/'.$filename);

        return $id;
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     */
    private function ensureHomeFolderNode(string $username, string $token, array $nodes, string $path): string
    {
        $home = '/users/'.$username;
        $this->assertStringStartsWith($home, $path);

        $currentId = $this->childFileNodeId($nodes, null, $username);
        $this->assertNotNull($currentId, 'No home FileNode for '.$username);

        foreach (array_filter(explode('/', substr($path, strlen($home)))) as $segment) {
            $childId = $this->childFileNodeId($nodes, $currentId, $segment);
            if ($childId === null) {
                $childId = $this->fileNodeJmap([
                    ['FileNode/set', ['accountId' => $username, 'create' => [
                        'd0' => ['parentId' => $currentId, 'name' => $segment, 'nodeType' => 'directory'],
                    ]], 'c0'],
                ], $token)->assertOk()->json('methodResponses.0.1.created.d0.id');
                $this->assertIsString($childId, 'FileNode/set did not create folder '.$segment);
            }
            $currentId = $childId;
        }

        return $currentId;
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     */
    private function childFileNodeId(array $nodes, ?string $parentId, string $name): ?string
    {
        foreach ($nodes as $id => $node) {
            if ($node['parentId'] === $parentId && $node['name'] === $name) {
                return (string) $id;
            }
        }

        return null;
    }

    protected function getDocContent(string $token, string $path): TestResponse
    {
        return $this->withBearer($token)->get('/api/v1/files/content?path='.$path);
    }
}
