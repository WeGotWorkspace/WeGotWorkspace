<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * The data directory the installer will write, and why that path was chosen.
 */
final class DataDirChoice
{
    public const REASON_ENVIRONMENT = 'environment';

    public const REASON_OUTSIDE = 'outside';

    public const REASON_FALLBACK_OWNED = 'fallback_owned';

    public const REASON_FALLBACK_UNAVAILABLE = 'fallback_unavailable';

    public const FALLBACK_PATH = './wgw-content';

    public function __construct(
        public readonly string $path,
        public readonly string $reason,
        public readonly bool $insidePublishedTree,
    ) {}

    /**
     * @return array{path: string, reason: string, inside_web_root: bool}
     */
    public function toState(): array
    {
        return [
            'path' => $this->path,
            'reason' => $this->reason,
            'inside_web_root' => $this->insidePublishedTree,
        ];
    }

    /**
     * @param  array<string, mixed>  $state
     */
    public static function fromState(array $state): ?self
    {
        $path = $state['path'] ?? null;
        $reason = $state['reason'] ?? null;
        if (! is_string($path) || trim($path) === '' || ! is_string($reason) || $reason === '') {
            return null;
        }

        return new self($path, $reason, (bool) ($state['inside_web_root'] ?? false));
    }

    public function isFallback(): bool
    {
        return $this->reason === self::REASON_FALLBACK_OWNED
            || $this->reason === self::REASON_FALLBACK_UNAVAILABLE;
    }
}
