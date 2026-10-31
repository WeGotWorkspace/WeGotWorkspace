<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\RequiresAssemblyId;

/**
 * BlobAssembly/finish (WGW extension, #1500): `{accountId, id}`. Terminal
 * and safe to repeat: checks the total length and turns the assembly into
 * one ordinary `jb-` blob. `blobId` is null while a hash rebuild still has
 * steps left; the client repeats the call.
 */
final class BlobAssemblyFinishMethod implements JmapMethodInterface
{
    use RequiresAssemblyId;

    public function __construct(private readonly BlobAssemblyService $assemblies) {}

    public function name(): string
    {
        return 'BlobAssembly/finish';
    }

    public function capability(): string
    {
        return JmapCapabilities::BLOB_ASSEMBLY;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $id = $this->assemblyId($args);

        return ['accountId' => $username] + $this->assemblies->finish($username, $id);
    }
}
