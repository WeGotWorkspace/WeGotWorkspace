<?php

declare(strict_types=1);

namespace App\Services\Tasks\Conversion;

final class ConversionSupport
{
    /**
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function deepMergeTaskPatch(array $existing, array $patch): array
    {
        return TaskConversionSupport::mergeTaskPatch($existing, $patch);
    }

    /** @param array<string, mixed> $payload */
    public static function deriveTitle(array $payload): string
    {
        $title = $payload['title'] ?? null;
        if (is_string($title) && trim($title) !== '') {
            return trim($title);
        }

        return 'task';
    }
}
