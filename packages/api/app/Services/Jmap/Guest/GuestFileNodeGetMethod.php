<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\FileNodeGetMethod;
use App\Services\Jmap\Methods\JmapMethodInterface;

/**
 * FileNode/get for a guest upload account (#1715): by id only. A get-all
 * walks and reconciles the whole shared tree, which an anonymous caller
 * must not be able to start; the upload queue always asks for ids.
 */
final class GuestFileNodeGetMethod implements JmapMethodInterface
{
    public function __construct(private readonly FileNodeGetMethod $get) {}

    public function name(): string
    {
        return 'FileNode/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        if (! is_array($args['ids'] ?? null)) {
            throw new JmapMethodException('invalidArguments', 'Guests fetch FileNodes by id.');
        }

        return $this->get->handle($username, $args);
    }
}
