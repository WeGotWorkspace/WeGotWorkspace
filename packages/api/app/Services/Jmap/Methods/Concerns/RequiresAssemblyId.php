<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods\Concerns;

use App\Services\Jmap\JmapMethodException;

/**
 * The `id` argument of BlobAssembly/append and BlobAssembly/finish (#1500).
 */
trait RequiresAssemblyId
{
    /**
     * @param  array<string, mixed>  $args
     */
    private function assemblyId(array $args): string
    {
        $id = $args['id'] ?? null;
        if (! is_string($id) || $id === '') {
            throw new JmapMethodException('invalidArguments', 'id is required.');
        }

        return $id;
    }
}
