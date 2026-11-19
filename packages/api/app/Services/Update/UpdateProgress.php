<?php

declare(strict_types=1);

namespace App\Services\Update;

/**
 * Reads the progress part of updates/state.json: lock, phase and progress.
 * The admin progress poll uses only this, so it stays cheap (#2242).
 */
final class UpdateProgress
{
    /**
     * @param  array<string, mixed>  $state
     * @return array{inProgress: bool, phase: ?string, current: ?array<mixed>, download: ?array<mixed>, phaseProgress: ?array<mixed>, cancelRequested: bool, cancelAllowed: bool}
     */
    public static function fields(array $state, bool $lockHeld): array
    {
        $phase = self::phase($state);
        $inProgress = $lockHeld || $phase !== null;
        $field = static fn (string $key): ?array => $inProgress && is_array($state[$key] ?? null) ? $state[$key] : null;

        return [
            'inProgress' => $inProgress,
            'phase' => $phase,
            'current' => $field('current'),
            'download' => $field('download'),
            'phaseProgress' => $field('phase_progress'),
            'cancelRequested' => $inProgress && (bool) ($state['cancel_requested'] ?? false),
            'cancelAllowed' => $phase !== null && self::isCancellablePhase($phase),
        ];
    }

    /**
     * @param  array<string, mixed>  $state
     */
    public static function phase(array $state): ?string
    {
        if (! is_string($state['phase'] ?? null)) {
            return null;
        }
        $phase = trim((string) $state['phase']);

        return $phase !== '' ? $phase : null;
    }

    public static function isCancellablePhase(string $phase): bool
    {
        return in_array($phase, ['downloading', 'extracting', 'backing_up'], true);
    }
}
