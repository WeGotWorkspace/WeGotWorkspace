<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * BlobAssembly/get (WGW extension, #1500): how far an assembly is (parts
 * accepted, hash rebuild pending), so the client can resume after a
 * time-out or reload from the last finished step.
 */
final class BlobAssemblyGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly BlobAssemblyService $assemblies) {}

    public function name(): string
    {
        return 'BlobAssembly/get';
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
        $result = $this->assemblies->get($username, $this->requestedIds($args));

        return [
            'accountId' => $username,
            'state' => 'none',
            'list' => $this->projectProperties($result['list'], $args),
            'notFound' => $result['notFound'],
        ];
    }
}
