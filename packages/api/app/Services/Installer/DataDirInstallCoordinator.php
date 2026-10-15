<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Session and request wiring for {@see DataDirCandidateResolver}.
 * The wizard and the headless plan both go through here.
 */
final class DataDirInstallCoordinator
{
    public function __construct(private DataDirCandidateResolver $resolver) {}

    /**
     * Reading installer state claims the directory. That reservation closes
     * the race between two installs. The per-install candidate name means an
     * abandoned claim does not take the only outside directory away from a
     * later install under the same parent.
     *
     * @param  array<string, mixed>  $state
     * @return array{path: string, reason: string, inside_web_root: bool}
     */
    public function describe(array $state): array
    {
        $stored = $state['data_dir_choice'] ?? null;
        if (is_array($stored)) {
            $choice = DataDirChoice::fromState($stored);
            if ($choice !== null) {
                return $choice->toState();
            }
        }

        return $this->resolver->propose($this->resolver->serverDocumentRoot())->toState();
    }

    /**
     * @return array{path: string, reason: string, inside_web_root: bool}
     */
    public function proposeForHeadless(): array
    {
        return $this->resolver->propose(null)->toState();
    }

    /**
     * @param  array<string, mixed>  $state
     * @param  array<string, mixed>  $db
     * @param  array<string, mixed>  $payload
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    public function bind(array $state, array $db, array $payload): array
    {
        $submitted = $payload['data_dir'] ?? null;
        $override = is_string($submitted) ? $submitted : null;
        if ($override === null || trim($override) === '') {
            $stored = $state['data_dir_choice'] ?? null;
            $choice = is_array($stored) ? DataDirChoice::fromState($stored) : null;
            $choice ??= $this->resolver->propose($this->resolver->serverDocumentRoot());
        } else {
            $choice = $this->resolver->accept($override, $this->resolver->serverDocumentRoot());
        }

        $this->resolver->apply($choice);
        $state['data_dir_choice'] = $choice->toState();

        return [$state, $this->resolver->placeSqliteDatabase($db, $choice->path)];
    }
}
